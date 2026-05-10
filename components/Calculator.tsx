
import React, { useState, useEffect, useRef } from 'react';
import { User, LogOut } from 'lucide-react';
import { AuthModal } from './AuthModal';
import { AthenaUser, onAuthChange, logoutUser, getCurrentUser } from '../lib/firebase';

interface CalculatorProps {
  onCommand: (command: string) => void;
}

const Calculator: React.FC<CalculatorProps> = ({ onCommand }) => {
  const [display, setDisplay] = useState('0');
  const [inputBuffer, setInputBuffer] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<AthenaUser | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } else {
        setCurrentUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Math-OS Command Map
  // 1+1=  -> Genesis (Onboarding)
  // 1999= -> Admin Login
  // 9÷11= -> Flash Check
  // 0÷0=  -> SOS
  // 7x7=  -> Pool Status
  // %=    -> Toggle Legend (NEW)
  // ...   -> Wipe

  const handlePress = (val: string) => {
    let newDisplay = display;
    let newBuffer = inputBuffer + val;

    // Special case for "..." (Wipe)
    if (val === '.') {
      if (display.endsWith('..')) {
        onCommand('WIPE');
        setDisplay('0');
        setInputBuffer('');
        return;
      }
    }

    if (val === 'C') {
      newDisplay = '0';
      newBuffer = '';
    } else if (val === '=') {
      // Check for Commands BEFORE evaluating math

      // 1. Toggle Legend Command
      if (newBuffer === '%=' || display === '%') {
        setShowManual(prev => !prev);
        setDisplay('0');
        setInputBuffer('');
        return;
      }

      // 2. Standard Commands
      if (newBuffer === '1+1=') {
        onCommand('GENESIS');
        return;
      }
      if (newBuffer === '1999=') {
        onCommand('LOGIN');
        return;
      }
      if (newBuffer === '9÷11=') {
        onCommand('FLASH_CHECK');
        setDisplay('0');
        setInputBuffer('');
        return;
      }
      if (newBuffer === '0÷0=') {
        onCommand('SOS');
        setDisplay('Error');
        setInputBuffer('');
        return;
      }
      if (newBuffer === '7x7=') {
        onCommand('POOL_STATUS');
        setDisplay('0');
        setInputBuffer('');
        return;
      }

      try {
        // Standard Math
        // Sanitizing input: replace visual operators with JS operators
        // Handle % as /100 for standard math if it appears in a number context (e.g. 50%)
        let expression = display
          .replace(/x/g, '*')
          .replace(/÷/g, '/')
          .replace(/%/g, '/100');

        // eslint-disable-next-line no-eval
        newDisplay = eval(expression).toString();
      } catch (e) {
        newDisplay = 'Error';
      }
    } else {
      if (display === '0' || display === 'Error') {
        newDisplay = val;
      } else {
        newDisplay += val;
      }
    }

    setDisplay(newDisplay);
    setInputBuffer(newBuffer);
  };

  // Hidden Manual Logic (Hold to show, release to hide)
  const startManualTimer = () => {
    pressTimer.current = setTimeout(() => {
      setShowManual(true);
    }, 1000); // Reduced to 1 second for better responsiveness
  };

  const endManualTimer = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    // Transient hold logic managed by state + commands
  };

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser(null);
  };

  const handleAuthSuccess = (user: AthenaUser) => {
    setCurrentUser(user);
  };

  const btnClass = "relative h-20 w-20 rounded-full text-3xl font-medium m-2 transition active:opacity-70 flex items-center justify-center select-none";
  const grayBtn = "bg-neutral-700 text-white";
  const orangeBtn = "bg-orange-500 text-white";
  const darkBtn = "bg-neutral-800 text-white";

  // Manual Overlay Component
  const GhostLabel = ({ text }: { text: string }) => (
    showManual ? (
      <span className="absolute inset-0 flex items-center justify-center text-[10px] uppercase font-bold text-athena-500/80 bg-black/80 rounded-full animate-pulse z-10 pointer-events-none">
        {text}
      </span>
    ) : null
  );

  return (
    <div className="flex flex-col h-full bg-black pb-8 px-4 relative">

      {/* DISCRETE SESSION BUTTON - Top Right Corner */}
      <div className="absolute top-4 right-4 z-30">
        {currentUser ? (
          // Logged in - Show avatar with logout option
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800/80 rounded-full border border-neutral-700">
              <div className="w-6 h-6 rounded-full bg-athena-600 flex items-center justify-center">
                <span className="text-white text-xs font-bold">
                  {currentUser.displayName[0].toUpperCase()}
                </span>
              </div>
              <span className="text-white text-xs font-medium max-w-[80px] truncate">
                {currentUser.displayName}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-full transition"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          // Not logged in - Show discrete "Session" button
          <button
            onClick={() => setShowAuthModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800/50 hover:bg-neutral-700/80 border border-neutral-700 rounded-full text-gray-400 hover:text-white transition group"
          >
            <User className="w-4 h-4" />
            <span className="text-xs font-medium">Session</span>
          </button>
        )}
      </div>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      {/* Visual Glitch Effect for Manual Mode */}
      {showManual && (
        <>
          <div className="absolute inset-0 bg-green-900/10 pointer-events-none z-0" />

          {/* The Hidden Legend */}
          <div className="absolute top-24 left-4 right-4 z-20 animate-in fade-in zoom-in duration-200">
            <div className="bg-neutral-900/95 border border-athena-500/50 rounded-xl p-4 shadow-2xl backdrop-blur-md relative">

              {/* Close Button */}
              <button
                onClick={() => setShowManual(false)}
                className="absolute top-2 right-2 p-2 text-gray-500 hover:text-white transition rounded-full hover:bg-white/10"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>

              <div className="flex justify-between items-center border-b border-athena-900 pb-2 mb-2 pr-8">
                <h3 className="text-athena-500 font-mono text-xs font-bold tracking-[0.2em]">SYSTEM COMMANDS</h3>
                <span className="w-2 h-2 rounded-full bg-athena-500 animate-pulse"></span>
              </div>
              <ul className="space-y-2 font-mono text-[10px] text-gray-400">
                <li className="flex justify-between items-center border-b border-white/5 pb-1">
                  <span className="text-white font-bold text-xs">1 + 1 =</span>
                  <span className="text-athena-200">Genesis Setup</span>
                </li>
                <li className="flex justify-between items-center border-b border-white/5 pb-1">
                  <span className="text-white font-bold text-xs">1999 =</span>
                  <span className="text-athena-200">Unlock Vault</span>
                </li>
                <li className="flex justify-between items-center border-b border-white/5 pb-1">
                  <span className="text-white font-bold text-xs">9 ÷ 11 =</span>
                  <span className="text-athena-200">Flash Balance</span>
                </li>
                <li className="flex justify-between items-center border-b border-white/5 pb-1">
                  <span className="text-white font-bold text-xs">7 x 7 =</span>
                  <span className="text-athena-200">Pool Status</span>
                </li>
                <li className="flex justify-between items-center border-b border-white/5 pb-1">
                  <span className="text-white font-bold text-xs">% =</span>
                  <span className="text-athena-200">Toggle Legend</span>
                </li>
                <li className="flex justify-between items-center border-b border-white/5 pb-1">
                  <span className="text-red-500 font-bold text-xs">0 ÷ 0 =</span>
                  <span className="text-red-400 font-bold">TRIGGER SOS</span>
                </li>
                <li className="flex justify-between items-center">
                  <span className="text-orange-500 font-bold text-xs">...</span>
                  <span className="text-orange-400">Wipe Cache</span>
                </li>
              </ul>
            </div>
          </div>
        </>
      )}

      {/* Display */}
      <div className="flex-1 flex items-end justify-end p-6 relative mt-12">
        <span className={`text-6xl font-light text-white tracking-tight break-all transition-opacity duration-300 ${showManual ? 'opacity-10 blur-sm' : 'opacity-100'}`}>
          {display}
        </span>

        {/* Help Hint */}
        {!showManual && (
          <div className="absolute top-0 left-0 p-4 text-[10px] text-gray-500 font-mono select-none tracking-widest uppercase opacity-60">
            Presiona %= para ver comandos
          </div>
        )}

        {showManual && (
          <div className="absolute bottom-6 right-6 text-right">
            <p className="text-athena-500 font-mono text-sm">ATHENA_OS v1.0</p>
            <p className="text-gray-500 text-xs">Secure Protocol Active</p>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex flex-col items-center">
        {/* Row 1 */}
        <div className="flex">
          <button onClick={() => handlePress('C')} className={`${btnClass} ${grayBtn}`}>C</button>
          <button onClick={() => handlePress('±')} className={`${btnClass} ${grayBtn}`}>±</button>
          <button onClick={() => handlePress('%')} className={`${btnClass} ${grayBtn}`}>
            %
            <GhostLabel text="LEGEND" />
          </button>
          <button onClick={() => handlePress('÷')} className={`${btnClass} ${orangeBtn}`}>÷</button>
        </div>
        {/* Row 2 */}
        <div className="flex">
          <button onClick={() => handlePress('7')} className={`${btnClass} ${darkBtn}`}>
            7
            <GhostLabel text="POOL" />
          </button>
          <button onClick={() => handlePress('8')} className={`${btnClass} ${darkBtn}`}>8</button>
          <button onClick={() => handlePress('9')} className={`${btnClass} ${darkBtn}`}>
            9
            <GhostLabel text="FLASH" />
          </button>
          <button onClick={() => handlePress('x')} className={`${btnClass} ${orangeBtn}`}>x</button>
        </div>
        {/* Row 3 */}
        <div className="flex">
          <button onClick={() => handlePress('4')} className={`${btnClass} ${darkBtn}`}>4</button>
          <button onClick={() => handlePress('5')} className={`${btnClass} ${darkBtn}`}>5</button>
          <button onClick={() => handlePress('6')} className={`${btnClass} ${darkBtn}`}>6</button>
          <button onClick={() => handlePress('-')} className={`${btnClass} ${orangeBtn}`}>-</button>
        </div>
        {/* Row 4 */}
        <div className="flex">
          <button onClick={() => handlePress('1')} className={`${btnClass} ${darkBtn}`}>
            1
            <GhostLabel text="GENESIS" />
          </button>
          <button onClick={() => handlePress('2')} className={`${btnClass} ${darkBtn}`}>2</button>
          <button onClick={() => handlePress('3')} className={`${btnClass} ${darkBtn}`}>3</button>
          <button onClick={() => handlePress('+')} className={`${btnClass} ${orangeBtn}`}>+</button>
        </div>
        {/* Row 5 */}
        <div className="flex">
          <button onClick={() => handlePress('0')} className={`${btnClass} ${darkBtn} !w-[calc(160px+16px)]`}>
            0
            <GhostLabel text="SOS" />
          </button>
          <button
            onClick={() => handlePress('.')}
            onTouchStart={startManualTimer}
            onTouchEnd={endManualTimer}
            onMouseDown={startManualTimer}
            onMouseUp={endManualTimer}
            className={`${btnClass} ${darkBtn}`}
          >
            .
          </button>
          <button onClick={() => handlePress('=')} className={`${btnClass} ${orangeBtn}`}>=</button>
        </div>
      </div>
    </div>
  );
};

export default Calculator;

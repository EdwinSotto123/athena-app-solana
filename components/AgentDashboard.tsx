
import React, { useState, useEffect } from 'react';
import { AgentTab, SafeContact } from '../types';
import { WalletView } from './WalletView';
import { EscapePlanner } from './EscapePlanner';
import { EvidenceLocker } from './EvidenceLocker';
import { PanicButton } from './PanicButton';
import { SafeDestinationSetup } from './SafeDestinationSetup';

interface AgentDashboardProps {
  startTab?: AgentTab;
  onWipe?: () => void;
}

const AgentDashboard: React.FC<AgentDashboardProps> = ({ startTab = 'HOME', onWipe = () => { } }) => {
  const [tab, setTab] = useState<AgentTab>(startTab);
  const [showSettings, setShowSettings] = useState(false);

  // State for the Safe Contact (lifted here so PanicButton can access it)
  const [safeContact, setSafeContact] = useState<SafeContact | null>(null);

  useEffect(() => {
    if (startTab) setTab(startTab);
  }, [startTab]);

  // Load safe contact from Firestore on mount
  useEffect(() => {
    let unsubscribe: any;

    const setupListener = async () => {
      const { auth, getSafeContact, loadEscapePlan } = await import('../lib/firebase');

      unsubscribe = auth.onAuthStateChanged(async (user) => {
        if (user) {
          // Try safe_contact first
          let contact = await getSafeContact(user.uid);

          // If not found, try from escape plan
          if (!contact) {
            const plan = await loadEscapePlan(user.uid);
            if (plan?.emergencyContact) {
              contact = {
                name: plan.emergencyContact.name,
                relationship: plan.emergencyContact.relationship,
                withdrawalMethod: plan.emergencyContact.withdrawalMethod || 'PHONE',
                contactInfo: plan.emergencyContact.contactInfo,
                phoneNumber: plan.emergencyContact.withdrawalMethod === 'PHONE' ? plan.emergencyContact.contactInfo : undefined,
                walletAddress: plan.emergencyContact.withdrawalMethod === 'WALLET' ? plan.emergencyContact.contactInfo : undefined,
                fullName: plan.emergencyContact.name
              };
            }
          }

          if (contact) {
            // Convert SafeContactInfo to SafeContact format
            setSafeContact({
              name: contact.name,
              method: contact.withdrawalMethod === 'WALLET' ? 'CODE' : 'TRUSTED_ALLY',
              addressOrDetails: contact.walletAddress || contact.phoneNumber || contact.contactInfo || ''
            });
          } else {
            setSafeContact(null);
          }
        } else {
          setSafeContact(null);
        }
      });
    };

    setupListener();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleSaveContact = (contact: SafeContact) => {
    setSafeContact(contact);
    setShowSettings(false);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-white relative">

      {/* Settings Modal */}
      {showSettings && (
        <SafeDestinationSetup
          onCancel={() => setShowSettings(false)}
          onSave={handleSaveContact}
          currentContact={safeContact}
        />
      )}

      {/* Header */}
      <div className="h-16 border-b border-neutral-800 flex items-center justify-between px-6 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-athena-500 to-purple-600 flex items-center justify-center font-bold font-serif text-xl shadow-lg shadow-athena-500/20">A</div>
          <span className="font-bold tracking-wide">ATHENA</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-[10px] text-gray-400 font-mono">ADK-TS ONLINE</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative">
        {tab === 'HOME' && <WalletView onOpenSettings={() => setShowSettings(true)} />}
        {tab === 'PLAN' && <EscapePlanner />}
        {tab === 'EVIDENCE' && <EvidenceLocker />}
        {tab === 'SOS' && <PanicButton safeContact={safeContact} onWipeComplete={onWipe} />}
      </div>

      {/* Navigation */}
      <div className="h-20 bg-neutral-900 border-t border-neutral-800 grid grid-cols-4 pb-4 shrink-0 z-20">
        <NavButton
          active={tab === 'HOME'}
          onClick={() => setTab('HOME')}
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>}
          label="Vault"
        />
        <NavButton
          active={tab === 'PLAN'}
          onClick={() => setTab('PLAN')}
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>}
          label="Plan"
        />
        <NavButton
          active={tab === 'EVIDENCE'}
          onClick={() => setTab('EVIDENCE')}
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>}
          label="Locker"
        />
        <NavButton
          active={tab === 'SOS'}
          onClick={() => setTab('SOS')}
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
          label="SOS"
          alert
        />
      </div>
    </div>
  );
};

const NavButton = ({ active, onClick, icon, label, alert = false }: any) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center justify-center gap-1 transition-all duration-300
      ${active ? (alert ? 'text-red-500 scale-110' : 'text-athena-500 scale-110') : 'text-gray-600 hover:text-gray-400'}
    `}
  >
    {icon}
    <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
  </button>
);

export default AgentDashboard;

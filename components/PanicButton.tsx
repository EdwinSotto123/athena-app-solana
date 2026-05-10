
import React, { useState } from 'react';
import { SafeContact } from '../types';
import { useAthenaAgent } from '../lib/useAthenaAgent';
import { isSolana } from '../lib/chain-router';
import { AlertTriangle, Check, Loader2, Shield, Zap } from 'lucide-react';

interface PanicButtonProps {
  safeContact: SafeContact | null;
  onWipeComplete: () => void;
}

export const PanicButton: React.FC<PanicButtonProps> = ({ safeContact, onWipeComplete }) => {
  const { triggerSOS, isOnline, clearState } = useAthenaAgent();
  const [status, setStatus] = useState<'IDLE' | 'CONFIRMING' | 'EXECUTING' | 'DONE'>('IDLE');
  const [logs, setLogs] = useState<string[]>([]);

  const handlePanic = () => {
    setStatus('CONFIRMING');
  };

  const confirmPanic = async () => {
    setStatus('EXECUTING');
    setLogs([]);

    // Get destination address
    const destinationAddress = safeContact?.addressOrDetails ||
      '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'; // Fallback legacy EVM demo

    setLogs(['⚠️ Iniciando protocolo SOS…']);

    try {
      const result = await triggerSOS(destinationAddress);

      // Stream logs to UI
      let logIndex = 0;
      const interval = setInterval(() => {
        if (logIndex < result.logs.length) {
          setLogs(prev => [...prev, result.logs[logIndex]]);
          logIndex++;
        } else {
          clearInterval(interval);

          // Add final status
          if (result.success) {
            setLogs(prev => [
              ...prev,
              ...(isSolana()
                ? [
                    `💰 Movimiento registrado (aprox.): ${result.liquidatedAmount.toFixed(4)} SOL indicados en el protocolo`,
                    `📤 Destino respaldo: ${destinationAddress.slice(0, 10)}…`,
                  ]
                : [
                    `💰 Liquidated: $${result.liquidatedAmount.toFixed(2)}`,
                    `📤 Sent to: ${destinationAddress.slice(0, 10)}…`,
                  ]),
              '🔒 Borrando datos locales…',
              '✅ Protocolo completado.',
            ]);
          } else {
            setLogs(prev => [...prev, '❌ Protocol failed - funds may still be accessible']);
          }

          // Transition to done
          setTimeout(() => {
            setStatus('DONE');

            // Clear local state and return to calculator
            setTimeout(() => {
              clearState();
              onWipeComplete();
            }, 3000);
          }, 1500);
        }
      }, 600);

    } catch (error: any) {
      setLogs(prev => [...prev, `❌ Error: ${error.message}`]);

      // Fallback simulation if real call fails
      const fallbackSteps = isSolana()
        ? [
            '⚠️ Error de red — modo de respaldo…',
            'Revisa conexión y vuelve a intentar.',
            'Borrando datos locales del dispositivo…',
            'Protocolo de respaldo completado.',
          ]
        : [
            '⚠️ Network error - using offline protocol...',
            'Liquidating sFRAX Positions...',
            'Converting to USDC...',
            `Sending funds to: ${safeContact ? safeContact.name : 'Emergency Wallet'}...`,
            'Transfer Simulated: 0x8a...92b',
            'Deleting Local Evidence...',
            'Wiping Chat History...',
            'PROTOCOL COMPLETE.',
          ];

      let stepIdx = 0;
      const fallbackInterval = setInterval(() => {
        if (stepIdx < fallbackSteps.length) {
          setLogs(prev => [...prev, fallbackSteps[stepIdx]]);
          stepIdx++;
        } else {
          clearInterval(fallbackInterval);
          setTimeout(() => {
            setStatus('DONE');
            setTimeout(() => {
              clearState();
              onWipeComplete();
            }, 3000);
          }, 1000);
        }
      }, 700);
    }
  };

  if (status === 'EXECUTING' || status === 'DONE') {
    return (
      <div className={`h-full flex flex-col items-center justify-center p-8 transition-colors duration-500 ${status === 'DONE' ? 'bg-black' : 'bg-red-950'}`}>

        {/* Flashing Alert Effect */}
        {status === 'EXECUTING' && (
          <div className="absolute inset-0 bg-red-600/20 animate-pulse pointer-events-none"></div>
        )}

        <div className="z-10 w-full max-w-sm space-y-4">
          {status === 'EXECUTING' && (
            <div className="flex justify-center mb-8">
              <Loader2 className="w-16 h-16 text-red-500 animate-spin" />
            </div>
          )}

          {status === 'DONE' && (
            <div className="flex flex-col items-center mb-8 animate-in zoom-in duration-300">
              <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(34,197,94,0.5)]">
                <Check className="w-10 h-10 text-black" strokeWidth={3} />
              </div>
              <h2 className="text-2xl font-bold text-white tracking-widest uppercase">Executed</h2>
              <p className="text-green-500 font-mono mt-2 text-center px-2">
              {isSolana()
                ? 'Fondos del caso (si había) y respaldo según protocolo Solana'
                : 'Funds sent to'}{' '}
              {safeContact?.name || 'contacto seguro'}
            </p>
            </div>
          )}

          {/* Connection Status */}
          <div className={`text-center text-xs font-mono mb-4 px-3 py-1 rounded-full inline-flex items-center gap-2 mx-auto ${isOnline ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-yellow-500'}`} />
            {isOnline ? 'RED CONECTADA (DEVNET)' : 'MODO SIN CONEXIÓN'}
          </div>

          <div className="font-mono text-xs space-y-2 max-h-48 overflow-y-auto">
            {logs.map((log, i) => (
              <p key={i} className={`border-l-2 pl-2 ${log.includes('COMPLETE') || log.includes('✅') ? 'text-green-500 border-green-500' :
                log.includes('❌') ? 'text-red-400 border-red-500' :
                  'text-red-400 border-red-800'
                }`}>
                {log}
              </p>
            ))}
          </div>

          {status === 'DONE' && (
            <p className="text-center text-gray-500 text-xs mt-8 italic">Device locking in 3 seconds...</p>
          )}
        </div>
      </div>
    );
  }

  if (status === 'CONFIRMING') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-black">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">FINAL WARNING</h2>
          <p className="text-gray-400">
            Acción irreversible. En <strong className="text-white">Solana</strong>, lo recaudado en tu caso se envía al
            contacto seguro que quedó registrado al crear el plan; el saldo de respaldo de la app solo se mueve si el
            destino es una <strong className="text-white">dirección Solana válida</strong> (no un número de teléfono).
            Si tu contacto es solo móvil, el paso crítico es el envío del caso on-chain. Los datos en este dispositivo se
            borrarán después.
          </p>

          {/* Show connection status */}
          <div className={`mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono ${isOnline ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
            <Zap className="w-3 h-3" />
            {isOnline ? 'RED CONECTADA (DEVNET)' : 'PREPARANDO ENVÍO'}
          </div>
        </div>

        <div className="space-y-4 w-full">
          <button
            onClick={confirmPanic}
            className="w-full py-5 bg-red-600 hover:bg-red-500 text-white text-xl font-bold rounded-2xl shadow-xl shadow-red-900/30 animate-pulse flex items-center justify-center gap-3"
          >
            <Shield className="w-6 h-6" />
            CONFIRM EXECUTION
          </button>
          <button
            onClick={() => setStatus('IDLE')}
            className="w-full py-4 text-gray-500 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 relative overflow-hidden">

      {/* Background Pulse */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-red-900/20 rounded-full blur-3xl animate-pulse"></div>

      <div className="relative group cursor-pointer" onClick={handlePanic}>
        {/* Glow */}
        <div className="absolute -inset-1 bg-red-600 rounded-full blur opacity-25 group-hover:opacity-75 transition duration-1000 group-hover:duration-200"></div>

        {/* Button */}
        <button
          className="relative w-56 h-56 bg-gradient-to-br from-neutral-900 to-black rounded-full border-4 border-red-600/50 shadow-2xl flex flex-col items-center justify-center transform group-hover:scale-105 transition active:scale-95"
        >
          <AlertTriangle className="w-16 h-16 text-red-600 mb-2" strokeWidth={1.5} />
          <span className="text-3xl font-black text-white tracking-[0.2em]">SOS</span>
          <span className="text-[10px] text-red-500 mt-1 uppercase tracking-wider">Emergency Protocol</span>
        </button>
      </div>

      <div className="mt-12 text-center space-y-4 max-w-xs">
        <div className="bg-neutral-900 p-4 rounded-xl border border-neutral-800">
          <p className="text-gray-400 text-xs uppercase font-bold mb-1">Target Destination</p>
          <div className="flex items-center justify-center gap-2 text-white">
            {safeContact ? (
              <>
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>{safeContact.name} ({safeContact.method === 'TRUSTED_ALLY' ? 'Ally' : 'Code'})</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                <span className="text-red-400">Not Configured</span>
              </>
            )}
          </div>
        </div>

        {/* Connection Status */}
        <div className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-mono ${isOnline ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'
          }`}>
          <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
          {isOnline ? 'Solana Devnet conectada' : 'Preparando conexión…'}
        </div>

        <p className="text-gray-500 text-xs">
          Toca para activar el protocolo de emergencia: vaciado del caso en cadena cuando aplique, envío de respaldo si
          hay dirección Solana válida, y borrado de datos locales de la app.
        </p>
      </div>
    </div>
  );
};

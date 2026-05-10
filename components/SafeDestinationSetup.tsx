
import React, { useState } from 'react';
import { SafeContact } from '../types';

interface Props {
  onSave: (contact: SafeContact) => void;
  onCancel: () => void;
  currentContact?: SafeContact | null;
}

export const SafeDestinationSetup: React.FC<Props> = ({ onSave, onCancel, currentContact }) => {
  const [name, setName] = useState(currentContact?.name || '');
  const [method, setMethod] = useState<SafeContact['method']>(currentContact?.method || 'TRUSTED_ALLY');
  const [address, setAddress] = useState(currentContact?.addressOrDetails || '');

  const handleSave = () => {
    if (!name || !address) return;
    onSave({ name, method, addressOrDetails: address });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-neutral-900 border border-neutral-700 w-full max-w-md rounded-2xl p-6 shadow-2xl relative">
        
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-athena-900/50 rounded-full flex items-center justify-center mx-auto mb-3 border border-athena-500/30">
            <svg className="w-6 h-6 text-athena-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          </div>
          <h2 className="text-xl font-bold text-white">Set Safe Destination</h2>
          <p className="text-sm text-gray-400 mt-1">
            Where should funds go if you trigger the SOS?
          </p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          
          <div>
            <label className="block text-xs uppercase text-gray-500 font-bold mb-1">Destination Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => setMethod('TRUSTED_ALLY')}
                className={`p-3 rounded-xl border text-sm font-medium transition ${method === 'TRUSTED_ALLY' ? 'bg-athena-600 border-athena-500 text-white' : 'bg-neutral-800 border-neutral-700 text-gray-400'}`}
              >
                Trusted Person
              </button>
              <button 
                onClick={() => setMethod('CASH_CODE')}
                className={`p-3 rounded-xl border text-sm font-medium transition ${method === 'CASH_CODE' ? 'bg-athena-600 border-athena-500 text-white' : 'bg-neutral-800 border-neutral-700 text-gray-400'}`}
              >
                Cash Code (ATM)
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase text-gray-500 font-bold mb-1">
              {method === 'TRUSTED_ALLY' ? 'Ally Name' : 'Recipient Name'}
            </label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sister Carla"
              className="w-full bg-black border border-neutral-700 rounded-xl p-3 text-white focus:border-athena-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs uppercase text-gray-500 font-bold mb-1">
               {method === 'TRUSTED_ALLY' ? 'Wallet Address / CBU' : 'ID Number for Pickup'}
            </label>
            <input 
              type="text" 
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={method === 'TRUSTED_ALLY' ? "0x..." : "ID Number"}
              className="w-full bg-black border border-neutral-700 rounded-xl p-3 text-white focus:border-athena-500 outline-none font-mono text-sm"
            />
            <p className="text-[10px] text-orange-400 mt-1 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              Do not use a shared bank account.
            </p>
          </div>

        </div>

        {/* Actions */}
        <div className="mt-8 flex gap-3">
          <button 
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl font-medium text-gray-400 hover:bg-neutral-800 transition"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={!name || !address}
            className="flex-1 bg-athena-600 hover:bg-athena-500 disabled:opacity-50 text-white py-3 rounded-xl font-bold transition shadow-lg shadow-athena-900/20"
          >
            Save Configuration
          </button>
        </div>

      </div>
    </div>
  );
};

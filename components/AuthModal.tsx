/**
 * Discrete Auth Modal Component
 * 
 * A hidden-style login/register modal that appears when clicking
 * the discrete "Session" button in the calculator corner.
 */

import React, { useState } from 'react';
import { registerUser, loginUser, AthenaUser } from '../lib/firebase';
import { User, UserPlus, Lock, Mail, Eye, EyeOff, X, Shield, Loader2 } from 'lucide-react';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAuthSuccess: (user: AthenaUser) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthSuccess }) => {
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            let user: AthenaUser;

            if (mode === 'register') {
                if (!displayName.trim()) {
                    setError('Please enter a display name');
                    setIsLoading(false);
                    return;
                }
                user = await registerUser(email, password, displayName);
            } else {
                user = await loginUser(email, password);
            }

            onAuthSuccess(user);
            onClose();

            // Reset form
            setEmail('');
            setPassword('');
            setDisplayName('');

        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleMode = () => {
        setMode(mode === 'login' ? 'register' : 'login');
        setError(null);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-neutral-900 rounded-2xl border border-neutral-700 w-full max-w-sm mx-4 overflow-hidden shadow-2xl animate-in zoom-in-95 fade-in duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-neutral-800">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-athena-600 flex items-center justify-center">
                            <Shield className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-sm">Secure Session</h3>
                            <p className="text-[10px] text-gray-500 font-mono">ENCRYPTED</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">

                    {/* Mode Toggle */}
                    <div className="flex bg-neutral-800 p-1 rounded-lg">
                        <button
                            type="button"
                            onClick={() => setMode('login')}
                            className={`flex-1 py-2 text-xs font-bold rounded-md transition flex items-center justify-center gap-1.5 ${mode === 'login'
                                    ? 'bg-athena-600 text-white'
                                    : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            <User className="w-3.5 h-3.5" />
                            Login
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('register')}
                            className={`flex-1 py-2 text-xs font-bold rounded-md transition flex items-center justify-center gap-1.5 ${mode === 'register'
                                    ? 'bg-athena-600 text-white'
                                    : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            <UserPlus className="w-3.5 h-3.5" />
                            Register
                        </button>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-xs">
                            {error}
                        </div>
                    )}

                    {/* Display Name (Register only) */}
                    {mode === 'register' && (
                        <div className="space-y-1.5">
                            <label className="text-gray-400 text-xs font-medium">Display Name</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder="Your alias"
                                    className="w-full bg-black border border-neutral-700 rounded-lg pl-10 pr-4 py-3 text-white text-sm focus:border-athena-500 outline-none transition placeholder-gray-600"
                                />
                            </div>
                        </div>
                    )}

                    {/* Email */}
                    <div className="space-y-1.5">
                        <label className="text-gray-400 text-xs font-medium">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="secure@email.com"
                                required
                                className="w-full bg-black border border-neutral-700 rounded-lg pl-10 pr-4 py-3 text-white text-sm focus:border-athena-500 outline-none transition placeholder-gray-600"
                            />
                        </div>
                    </div>

                    {/* Password */}
                    <div className="space-y-1.5">
                        <label className="text-gray-400 text-xs font-medium">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                minLength={6}
                                className="w-full bg-black border border-neutral-700 rounded-lg pl-10 pr-12 py-3 text-white text-sm focus:border-athena-500 outline-none transition placeholder-gray-600"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition"
                            >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-athena-600 hover:bg-athena-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-bold transition flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <Shield className="w-4 h-4" />
                                {mode === 'login' ? 'Secure Login' : 'Create Account'}
                            </>
                        )}
                    </button>

                    {/* Privacy Note */}
                    <p className="text-center text-[10px] text-gray-600">
                        Your data is encrypted end-to-end.
                        {mode === 'register' && ' No personal info required.'}
                    </p>
                </form>
            </div>
        </div>
    );
};

export default AuthModal;

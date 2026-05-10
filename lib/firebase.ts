/**
 * Firebase Configuration & Services
 * 
 * Provides:
 * - Firebase App initialization
 * - Authentication (Email/Password)
 * - Firestore for chat memory and user data
 */

import { initializeApp } from 'firebase/app';
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    User
} from 'firebase/auth';
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    getDoc,
    addDoc,
    query,
    orderBy,
    limit,
    getDocs,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';

// ============ FIREBASE CONFIG ============

// Use Vite environment variables. Client environment variables that should
// be exposed to the browser must be prefixed with `VITE_`.
const env = import.meta.env as Record<string, unknown>;

function getEnv(name: string, value: unknown): string {
    if (!value) {
        throw new Error(`[Firebase] Missing environment variable: ${name}`);
    }
    return String(value);
}

const firebaseConfig = {
    apiKey: getEnv('VITE_FIREBASE_API_KEY', env.VITE_FIREBASE_API_KEY),
    authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN', env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: getEnv('VITE_FIREBASE_PROJECT_ID', env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET', env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: getEnv('VITE_FIREBASE_APP_ID', env.VITE_FIREBASE_APP_ID),
    measurementId: (env.VITE_FIREBASE_MEASUREMENT_ID as string) || undefined
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ============ TYPES ============

export interface AthenaUser {
    uid: string;
    displayName: string;
    email: string;
    createdAt: Date;
    caseId?: string;
    safeContactAddress?: string;
}

export interface ChatMessage {
    id?: string;
    role: 'user' | 'model';
    text: string;
    timestamp?: Date;
}

export interface UserSession {
    user: AthenaUser | null;
    isLoading: boolean;
    error: string | null;
}

// ============ AUTH FUNCTIONS ============

/**
 * Register new user with email and password
 */
export async function registerUser(
    email: string,
    password: string,
    displayName: string
): Promise<AthenaUser> {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Create user profile in Firestore
        const athenaUser: AthenaUser = {
            uid: user.uid,
            displayName,
            email: user.email || email,
            createdAt: new Date(),
            caseId: `ATHENA-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
        };

        await setDoc(doc(db, 'users', user.uid), {
            ...athenaUser,
            createdAt: serverTimestamp()
        });

        console.log('[Firebase] User registered:', athenaUser.displayName);
        return athenaUser;

    } catch (error: any) {
        console.error('[Firebase] Registration error:', error);
        throw new Error(getAuthErrorMessage(error.code));
    }
}

/**
 * Sign in existing user
 */
export async function loginUser(email: string, password: string): Promise<AthenaUser> {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Get user profile from Firestore
        const userDoc = await getDoc(doc(db, 'users', user.uid));

        if (userDoc.exists()) {
            const data = userDoc.data();
            return {
                uid: user.uid,
                displayName: data.displayName,
                email: data.email,
                createdAt: data.createdAt?.toDate() || new Date(),
                caseId: data.caseId,
                safeContactAddress: data.safeContactAddress
            };
        }

        // Fallback if no Firestore profile
        return {
            uid: user.uid,
            displayName: user.email?.split('@')[0] || 'Agent',
            email: user.email || email,
            createdAt: new Date()
        };

    } catch (error: any) {
        console.error('[Firebase] Login error:', error);
        throw new Error(getAuthErrorMessage(error.code));
    }
}

/**
 * Sign out current user
 */
export async function logoutUser(): Promise<void> {
    try {
        await signOut(auth);
        console.log('[Firebase] User signed out');
    } catch (error) {
        console.error('[Firebase] Logout error:', error);
    }
}

/**
 * Get current user profile
 */
export async function getCurrentUser(): Promise<AthenaUser | null> {
    const user = auth.currentUser;

    if (!user) return null;

    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));

        if (userDoc.exists()) {
            const data = userDoc.data();
            return {
                uid: user.uid,
                displayName: data.displayName,
                email: data.email,
                createdAt: data.createdAt?.toDate() || new Date(),
                caseId: data.caseId,
                safeContactAddress: data.safeContactAddress
            };
        }

        return null;
    } catch (error) {
        console.error('[Firebase] Get user error:', error);
        return null;
    }
}

/**
 * Subscribe to auth state changes
 */
export function onAuthChange(callback: (user: User | null) => void): () => void {
    return onAuthStateChanged(auth, callback);
}

// ============ FIRESTORE CHAT FUNCTIONS ============

/**
 * Save chat message to Firestore
 */
export async function saveChatMessage(
    userId: string,
    message: { role: 'user' | 'model'; text: string }
): Promise<string> {
    try {
        const chatRef = collection(db, 'users', userId, 'chat_history');
        const docRef = await addDoc(chatRef, {
            role: message.role,
            text: message.text,
            timestamp: serverTimestamp()
        });
        return docRef.id;
    } catch (error) {
        console.error('[Firebase] Save chat error:', error);
        throw error;
    }
}

/**
 * Load chat history from Firestore
 */
export async function loadChatHistory(
    userId: string,
    messageLimit: number = 50
): Promise<ChatMessage[]> {
    try {
        const chatRef = collection(db, 'users', userId, 'chat_history');
        const q = query(chatRef, orderBy('timestamp', 'asc'), limit(messageLimit));
        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => ({
            id: doc.id,
            role: doc.data().role,
            text: doc.data().text,
            timestamp: doc.data().timestamp?.toDate() || new Date()
        }));
    } catch (error) {
        console.error('[Firebase] Load chat error:', error);
        return [];
    }
}

/**
 * Save escape plan to Firestore
 */
export async function saveEscapePlan(userId: string, plan: any): Promise<void> {
    try {
        await setDoc(doc(db, 'users', userId, 'plans', 'current'), {
            ...plan,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error('[Firebase] Save plan error:', error);
    }
}

/**
 * Load escape plan from Firestore
 */
export async function loadEscapePlan(userId: string): Promise<any | null> {
    try {
        const planDoc = await getDoc(doc(db, 'users', userId, 'plans', 'current'));
        return planDoc.exists() ? planDoc.data() : null;
    } catch (error) {
        console.error('[Firebase] Load plan error:', error);
        return null;
    }
}

/** Optional country/region for planner + resource recommendations */
export interface PlannerProfile {
    country?: string;
    region?: string;
    city?: string;
}

export async function savePlannerProfile(
    userId: string,
    profile: PlannerProfile
): Promise<void> {
    try {
        await setDoc(
            doc(db, 'users', userId, 'profiles', 'planner'),
            {
                ...profile,
                updatedAt: serverTimestamp(),
            },
            { merge: true }
        );
    } catch (error) {
        console.error('[Firebase] Save planner profile error:', error);
        throw error;
    }
}

export async function loadPlannerProfile(userId: string): Promise<PlannerProfile | null> {
    try {
        const snap = await getDoc(doc(db, 'users', userId, 'profiles', 'planner'));
        if (!snap.exists()) return null;
        const d = snap.data();
        return {
            country: d.country || '',
            region: d.region || '',
            city: d.city || '',
        };
    } catch (error) {
        console.error('[Firebase] Load planner profile error:', error);
        return null;
    }
}

// ============ SAFE CONTACT FUNCTIONS ============

export type WithdrawalMethod = 'WALLET' | 'PHONE' | 'CASH_CODE';

export interface SafeContactInfo {
    name: string;
    relationship: string;
    withdrawalMethod: WithdrawalMethod;

    // For WALLET method
    walletAddress?: string;

    // For PHONE method (Yape, M-Pesa, etc.)
    phoneNumber?: string;
    phoneCountry?: string;

    // For CASH_CODE method (Western Union, MoneyGram)
    fullName?: string;
    country?: string;

    // Legacy field (backwards compatibility)
    contactInfo?: string;

    createdAt?: Date;
}

/**
 * Save or update safe contact for SOS feature
 */
export async function saveSafeContact(
    userId: string,
    contact: SafeContactInfo
): Promise<void> {
    try {
        await setDoc(doc(db, 'users', userId, 'safe_contact', 'primary'), {
            ...contact,
            createdAt: serverTimestamp()
        });

        // Also update the user document for quick access
        await setDoc(doc(db, 'users', userId), {
            safeContactName: contact.name,
            safeContactInfo: contact.contactInfo
        }, { merge: true });

        console.log('[Firebase] Safe contact saved:', contact.name);
    } catch (error) {
        console.error('[Firebase] Save contact error:', error);
    }
}

/**
 * Get safe contact for SOS feature
 */
export async function getSafeContact(userId: string): Promise<SafeContactInfo | null> {
    try {
        // 1. Try dedicated contact document first
        const contactDoc = await getDoc(doc(db, 'users', userId, 'safe_contact', 'primary'));

        if (contactDoc.exists()) {
            const data = contactDoc.data();
            return {
                name: data.name,
                relationship: data.relationship,
                withdrawalMethod: data.withdrawalMethod || 'WALLET',
                walletAddress: data.walletAddress,
                phoneNumber: data.phoneNumber,
                phoneCountry: data.phoneCountry,
                fullName: data.fullName,
                country: data.country,
                contactInfo: data.contactInfo,
                createdAt: data.createdAt?.toDate()
            };
        }

        // 2. Fallback: Try to get from active Escape Plan
        // This handles cases where plan was generated but settings not explicitly saved
        const planDoc = await getDoc(doc(db, 'users', userId, 'plans', 'current'));
        if (planDoc.exists()) {
            const plan = planDoc.data();
            if (plan.emergencyContact) {
                const ec = plan.emergencyContact;
                return {
                    name: ec.name,
                    relationship: ec.relationship,
                    withdrawalMethod: ec.withdrawalMethod || 'PHONE',
                    contactInfo: ec.contactInfo,
                    phoneNumber: ec.withdrawalMethod === 'PHONE' ? ec.contactInfo : undefined,
                    walletAddress: ec.withdrawalMethod === 'WALLET' ? ec.contactInfo : undefined,
                    fullName: ec.name,
                    createdAt: plan.updatedAt?.toDate() || new Date()
                };
            }
        }

        return null;
    } catch (error) {
        console.error('[Firebase] Get contact error:', error);
        return null;
    }
}

/**
 * Legacy function - redirects to saveSafeContact
 */
export async function updateSafeContact(
    userId: string,
    safeContactAddress: string
): Promise<void> {
    await saveSafeContact(userId, {
        name: 'Emergency Contact',
        relationship: 'Unknown',
        withdrawalMethod: 'WALLET',
        walletAddress: safeContactAddress,
        contactInfo: safeContactAddress
    });
}

// ============ PUBLIC DONATION LISTINGS (marketplace /donate) ============

export function normalizeCaseListingCaseId(raw: string): string | null {
  const hex = raw.replace(/-/g, '').trim();
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Construye un `CaseListing` desde el documento `users/{uid}/plans/current` (UUID + programa). */
export function escapePlanToCaseListing(plan: unknown): CaseListing | null {
  if (!plan || typeof plan !== 'object') return null;
  const p = plan as Record<string, unknown>;
  const rawId = typeof p.caseId === 'string' ? p.caseId.trim() : '';
  const caseId = normalizeCaseListingCaseId(rawId);
  if (!caseId) return null;
  const envPid = String(import.meta.env.VITE_SOLANA_PROGRAM_ID ?? '').trim();
  const programId = String(p.poolContractAddress || '').trim() || envPid;
  if (!programId) return null;
  const fg = p.freedomGoal as Record<string, unknown> | undefined;
  const targetUsd =
    fg && typeof fg.targetAmount === 'number' && Number.isFinite(fg.targetAmount)
      ? fg.targetAmount
      : 0;
  const currency = fg && typeof fg.currency === 'string' ? fg.currency : 'USD';
  const destination = typeof p.destination === 'string' ? p.destination : '';
  const riskLevel = typeof p.riskLevel === 'number' ? p.riskLevel : null;
  const cr = p.chainRegistration as { ok?: boolean } | undefined;
  const beneficiaryPseudonym =
    typeof p.beneficiaryPseudonym === 'string' ? p.beneficiaryPseudonym.trim() : '';
  const donorPublicNarrative =
    typeof p.donorPublicNarrative === 'string' ? p.donorPublicNarrative.trim() : '';
  return {
    caseId,
    programId,
    targetUsd,
    currency,
    destination,
    riskLevel,
    active: true,
    chainRegistered: cr?.ok === true,
    origin: 'my_plan',
    ...(beneficiaryPseudonym ? { beneficiaryPseudonym } : {}),
    ...(donorPublicNarrative ? { donorPublicNarrative } : {}),
  };
}

function formatCaseListingsQueryError(e: unknown): string {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : '';
  if (code === 'permission-denied') {
    return (
      'Firestore: permission-denied al leer `case_listings`. ' +
      'Permite lectura pública de esa colección en las reglas (véase `case_listings.firestore.rules` en el repo).'
    );
  }
  if (e instanceof Error) return e.message;
  return 'No se pudieron cargar los casos';
}

/** Caso publicado para exploración y donaciones (sin datos sensibles del usuario). */
export interface CaseListing {
  caseId: string;
  programId: string;
  targetUsd: number;
  currency: string;
  destination: string;
  riskLevel?: number | null;
  /** false = publicado en marketplace pero initialize_case aún no ok (o falló). */
  chainRegistered?: boolean;
  active?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  /**
   * `my_plan` = fila añadida desde el plan actual del usuario (users/.../plans/current)
   * cuando aún no existe documento en `case_listings`.
   */
  origin?: 'firestore' | 'my_plan';
  /** Desnormalizado desde el locker para el marketplace (métricas de confianza). */
  evidenceTotalCount?: number;
  evidenceVideoCount?: number;
  evidenceAnchoredCount?: number;
  /** Frase corta opcional para donantes (ej. contexto validado por el planner). */
  trustBlurb?: string;
  /** Nombre ficticio solo para la página de donaciones (p. ej. “Virginia”). */
  beneficiaryPseudonym?: string;
  /** Relato breve para donantes (sin datos identificantes). */
  donorPublicNarrative?: string;
}

/**
 * Crea o actualiza el anuncio público del caso (mismo id que el UUID on-chain).
 * Requiere reglas Firestore que permitan lectura pública de `case_listings`.
 */
export async function saveCaseListing(entry: {
  caseId: string;
  programId: string;
  targetUsd: number;
  currency?: string;
  destination?: string;
  riskLevel?: number;
  active?: boolean;
  chainRegistered?: boolean;
  trustBlurb?: string;
  beneficiaryPseudonym?: string;
  donorPublicNarrative?: string;
}): Promise<void> {
  const ref = doc(db, 'case_listings', entry.caseId);
  const snap = await getDoc(ref);
  const payload: Record<string, unknown> = {
    caseId: entry.caseId,
    programId: entry.programId,
    targetUsd: entry.targetUsd,
    currency: entry.currency || 'USD',
    destination: entry.destination || '',
    riskLevel: entry.riskLevel ?? null,
    active: entry.active !== false,
    updatedAt: serverTimestamp(),
  };
  if (entry.chainRegistered !== undefined) {
    payload.chainRegistered = entry.chainRegistered;
  }
  if (entry.trustBlurb !== undefined) {
    payload.trustBlurb = entry.trustBlurb;
  }
  if (entry.beneficiaryPseudonym !== undefined) {
    payload.beneficiaryPseudonym = entry.beneficiaryPseudonym;
  }
  if (entry.donorPublicNarrative !== undefined) {
    payload.donorPublicNarrative = entry.donorPublicNarrative;
  }
  if (!snap.exists()) {
    payload.createdAt = serverTimestamp();
  }
  await setDoc(ref, payload, { merge: true });
  console.log('[Firebase] Case listing saved:', entry.caseId);
}

export async function getCaseListing(caseId: string): Promise<CaseListing | null> {
  try {
    const snap = await getDoc(doc(db, 'case_listings', caseId));
    if (!snap.exists()) return null;
    return snap.data() as CaseListing;
  } catch (e) {
    console.error('[Firebase] getCaseListing', e);
    return null;
  }
}

/** Conteos del Evidence Locker para métricas públicas (marketplace). */
export async function getEvidenceStatsForUser(userId: string): Promise<{
  total: number;
  video: number;
  anchored: number;
}> {
  try {
    const evidenceRef = collection(db, 'users', userId, 'evidence');
    const snapshot = await getDocs(evidenceRef);
    let video = 0;
    let anchored = 0;
    snapshot.forEach((d) => {
      const x = d.data() as { type?: string; status?: string; txHash?: string };
      if (x.type === 'VIDEO') video++;
      if (x.status === 'SECURED_ON_CHAIN' || (x.txHash && String(x.txHash).length > 0)) {
        anchored++;
      }
    });
    return { total: snapshot.size, video, anchored };
  } catch (e) {
    console.warn('[Firebase] getEvidenceStatsForUser', e);
    return { total: 0, video: 0, anchored: 0 };
  }
}

/**
 * Actualiza en `case_listings` los conteos de evidencias del usuario (videos, anclajes on-chain).
 * Firestore: escritura autenticada; lectura pública del listing.
 */
export async function mergeCaseListingEvidenceStats(userId: string, caseIdRaw: string): Promise<void> {
  const caseId = normalizeCaseListingCaseId(caseIdRaw.trim());
  if (!caseId || !userId) return;
  try {
    const stats = await getEvidenceStatsForUser(userId);
    await setDoc(
      doc(db, 'case_listings', caseId),
      {
        caseId,
        evidenceTotalCount: stats.total,
        evidenceVideoCount: stats.video,
        evidenceAnchoredCount: stats.anchored,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    console.warn('[Firebase] mergeCaseListingEvidenceStats', e);
  }
}

function listingSortMs(c: CaseListing): number {
  const t = c.updatedAt ?? c.createdAt;
  if (t && typeof (t as Timestamp).toMillis === 'function') {
    return (t as Timestamp).toMillis();
  }
  if (t && typeof t === 'object' && 'seconds' in t) {
    return (t as { seconds: number }).seconds * 1000;
  }
  return 0;
}

/** Listados recientes para el marketplace (orden por última actualización). */
export async function listActiveCaseListings(maxDocs = 40): Promise<CaseListing[]> {
  const ref = collection(db, 'case_listings');
  const fromSnapshotDocs = (
    docs: Array<{ data: () => Record<string, unknown> }>,
  ): CaseListing[] =>
    docs
      .map((d) => d.data() as unknown as CaseListing)
      .filter((x) => x && x.active !== false);

  try {
    const q = query(ref, orderBy('updatedAt', 'desc'), limit(maxDocs));
    const snap = await getDocs(q);
    return fromSnapshotDocs(snap.docs);
  } catch (e) {
    console.warn(
      '[Firebase] listActiveCaseListings: consulta con índice falló; usando lectura completa + orden local.',
      e,
    );
    try {
      const snap = await getDocs(ref);
      const rows = fromSnapshotDocs(snap.docs).sort(
        (a, b) => listingSortMs(b) - listingSortMs(a),
      );
      return rows.slice(0, maxDocs);
    } catch (e2) {
      console.error('[Firebase] listActiveCaseListings', e2);
      throw new Error(formatCaseListingsQueryError(e2));
    }
  }
}

// ============ EVIDENCE LOCKER STORAGE ============

/**
 * Save evidence item to Firestore
 */
export async function saveEvidence(userId: string, evidence: {
    id: string;
    timestamp: number;
    content: string;
    type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO';
    hash: string;
    txHash?: string;
    status: 'PENDING' | 'SECURED_ON_CHAIN';
    ipfsCid?: string;
    ipfsUrl?: string;
    analysis?: {
        category: string;
        riskLevel: number;
        summary: string;
    };
}): Promise<void> {
    try {
        const docData: Record<string, unknown> = {
            id: evidence.id,
            timestamp: evidence.timestamp,
            content: evidence.content,
            type: evidence.type,
            hash: evidence.hash,
            status: evidence.status,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        if (evidence.txHash != null && String(evidence.txHash).length > 0) {
            docData.txHash = evidence.txHash;
        }
        if (evidence.ipfsCid != null && String(evidence.ipfsCid).length > 0) {
            docData.ipfsCid = evidence.ipfsCid;
        }
        if (evidence.ipfsUrl != null && String(evidence.ipfsUrl).length > 0) {
            docData.ipfsUrl = evidence.ipfsUrl;
        }
        if (evidence.analysis != null) {
            docData.analysis = evidence.analysis;
        }

        await setDoc(doc(db, 'users', userId, 'evidence', evidence.id), docData);
        console.log('[Firebase] Evidence saved:', evidence.id);
    } catch (error) {
        console.error('[Firebase] Save evidence error:', error);
        throw error;
    }
}

/**
 * Load all evidence items from Firestore
 */
export async function loadEvidence(userId: string, maxItems: number = 50): Promise<any[]> {
    try {
        const evidenceRef = collection(db, 'users', userId, 'evidence');
        const q = query(evidenceRef, orderBy('timestamp', 'desc'), limit(maxItems));
        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error('[Firebase] Load evidence error:', error);
        return [];
    }
}

/**
 * Delete evidence item from Firestore
 */
export async function deleteEvidence(userId: string, evidenceId: string): Promise<void> {
    try {
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'users', userId, 'evidence', evidenceId));
        console.log('[Firebase] Evidence deleted:', evidenceId);
    } catch (error) {
        console.error('[Firebase] Delete evidence error:', error);
    }
}

// ============ HELPERS ============

function getAuthErrorMessage(code: string): string {
    switch (code) {
        case 'auth/email-already-in-use':
            return 'This email is already registered. Try logging in.';
        case 'auth/weak-password':
            return 'Password should be at least 6 characters.';
        case 'auth/invalid-email':
            return 'Invalid email address.';
        case 'auth/user-not-found':
            return 'No account found with this email.';
        case 'auth/wrong-password':
            return 'Incorrect password.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please try later.';
        default:
            return 'Authentication failed. Please try again.';
    }
}

export default app;

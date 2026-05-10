
export enum AppMode {
  CALCULATOR = 'CALCULATOR',
  AGENT_DASHBOARD = 'AGENT_DASHBOARD',
  ONBOARDING_CHAT = 'ONBOARDING_CHAT'
}

export interface EvidenceAnalysis {
  summary: string;
  riskLevel: number; // 1-10
  category: 'PHYSICAL' | 'EMOTIONAL' | 'FINANCIAL' | 'THREAT' | 'UNCATEGORIZED';
  keywords: string[];
}

export type EvidenceType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO';

export interface EvidenceItem {
  id: string;
  timestamp: number;
  content: string; // Description or text content
  type: EvidenceType;
  mediaData?: string; // Base64 string for images or audio
  hash: string; // SHA-256 of the evidence (NOT the on-chain tx)
  txHash?: string; // On-chain tx signature (Solana sig / EVM tx hash)
  status: 'PENDING' | 'SECURED_ON_CHAIN';
  analysis?: EvidenceAnalysis; // New field for AI Forensic Data
  ipfsCid?: string; // IPFS Content ID
  ipfsUrl?: string; // Gateway URL for viewing
}

/** Hotlines / shelters / police — tailored by country when planner has context */
export interface LocalResource {
  name: string;
  type: 'EMERGENCY' | 'POLICE' | 'DV_HOTLINE' | 'SHELTER' | 'LEGAL' | 'OTHER';
  phoneOrUrl: string;
  notes?: string;
}

/** Paso concreto del plan (abogados gratuitos, horarios, qué llevar, enlace a mapa). */
export interface PlanActionStep {
  title: string;
  instructions: string;
  /** Búsqueda para Maps o URL https completa */
  mapQueryOrUrl?: string;
  phone?: string;
  whatToBring?: string;
}

export interface EscapePlan {
  isReady: boolean;
  /** Solana: UUID v4 (PDAs). Legacy: ATHENA-… string (not valid on-chain). */
  caseId?: string;
  poolContractAddress?: string; // On Solana: Athena program id; legacy EVM pool address
  /** Solana admin `initialize_case` result after plan is saved */
  chainRegistration?: { ok: boolean; txHash?: string; error?: string };
  /** Filled by AI when user shares location */
  locationContext?: {
    country?: string;
    regionOrState?: string;
    city?: string;
    /** Distrito, barrio o zona (sin domicilio exacto). */
    districtOrNeighborhood?: string;
    confidence?: 'explicit' | 'inferred' | 'unknown';
  };
  localResources?: LocalResource[];
  freedomGoal: {
    targetAmount: number;
    currentAmount: number;
    currency: string;
    breakdown?: {
      transport: number;
      supplies: number;
      shelter: number;
      legal: number;
    };
  };
  strategy: {
    step1: string;
    step2: string;
    step3: string;
  };
  riskLevel: number; // 1-10
  destination: string;
  emergencyContact?: {
    name: string;
    contactInfo: string;
    relationship: string;
    withdrawalMethod?: 'WALLET' | 'PHONE' | 'CASH_CODE';
  };
  nextSteps?: string[];
  /** Nombre ficticio para donantes / marketplace (nunca el nombre real de la persona). */
  beneficiaryPseudonym?: string;
  /** Relato breve para la página de donaciones (IA, sin datos identificantes). */
  donorPublicNarrative?: string;
  /** Pasos detallados con enlaces o búsqueda de mapa. */
  actionableSteps?: PlanActionStep[];
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface WalletState {
  totalValue: number;
  savings: number;     // User deposits
  yieldEarned: number; // sFRAX growth
  communityAngels: number; // Donations
  freedomGoalAmount: number; // e.g., 1600
  apy: number;
}

export interface SafeContact {
  name: string;
  method: 'TRUSTED_ALLY' | 'CASH_CODE' | 'CRYPTO_WALLET';
  addressOrDetails: string;
}

export type AgentTab = 'HOME' | 'PLAN' | 'EVIDENCE' | 'SOS';

export const generateHash = async (message: string): Promise<string> => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return "0x" + hashHex;
};

// Simulate a transaction delay
export const mockTransaction = async (ms: number = 2000) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};
import { platform } from "../platform";

/**
 * Secure random number generation utilities that work across platforms.
 * On React Native, will use expo-crypto when available for better security.
 * Falls back to platform-appropriate alternatives when needed.
 */

/**
 * Generate cryptographically secure random bytes asynchronously.
 * Preferred method on React Native when expo-crypto is available.
 * 
 * @param size Number of bytes to generate
 * @returns Promise resolving to secure random bytes
 */
export async function getSecureRandomBytesAsync(size: number): Promise<Uint8Array> {
  if (platform.crypto.randomBytesAsync) {
    return platform.crypto.randomBytesAsync(size);
  }
  // Fallback to sync version
  return platform.crypto.randomBytes(size);
}

/**
 * Generate random bytes synchronously.
 * On React Native without expo-crypto, this uses Math.random (less secure).
 * Use getSecureRandomBytesAsync() when possible for better security.
 * 
 * @param size Number of bytes to generate
 * @returns Random bytes (secure on Node.js, less secure on RN without expo-crypto)
 */
export function getRandomBytes(size: number): Uint8Array {
  return platform.crypto.randomBytes(size);
}

/**
 * Check if secure random number generation is available on the current platform.
 * 
 * @returns True if cryptographically secure RNG is available
 */
export function isSecureRandomAvailable(): boolean {
  return platform.crypto.isSecureRandomAvailable ?? true;
}

/**
 * Generate a cryptographically secure random hex string.
 * 
 * @param length Length of the hex string (will use length/2 random bytes)
 * @returns Promise resolving to hex string
 */
export async function getSecureRandomHexAsync(length: number): Promise<string> {
  const bytes = await getSecureRandomBytesAsync(Math.ceil(length / 2));
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

/**
 * Generate a random hex string synchronously.
 * 
 * @param length Length of the hex string (will use length/2 random bytes)
 * @returns Hex string
 */
export function getRandomHex(length: number): string {
  const bytes = getRandomBytes(Math.ceil(length / 2));
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

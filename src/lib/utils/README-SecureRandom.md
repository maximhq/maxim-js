# Secure Random Number Generation

This SDK provides secure random number generation that works across both Node.js and React Native environments.

## Key Features

### Node.js
- Uses Node.js `crypto.randomBytes()` for cryptographically secure random numbers
- Both sync and async APIs available
- Always secure

### React Native
- **With expo-crypto**: Uses `expo-crypto.getRandomBytesAsync()` for secure random generation
- **Without expo-crypto**: Falls back to Math.random()-based generation (less secure)
- Async API preferred for better security
- Warns when using insecure fallback

## Usage

```typescript
import { 
  getSecureRandomBytesAsync, 
  getRandomBytes, 
  isSecureRandomAvailable,
  getSecureRandomHexAsync,
  getRandomHex
} from '@maximai/maxim-js';

// Recommended: Async secure random (works with expo-crypto on RN)
const secureBytes = await getSecureRandomBytesAsync(32);
const secureHex = await getSecureRandomHexAsync(16);

// Synchronous (may be less secure on RN without expo-crypto)
const bytes = getRandomBytes(32);
const hex = getRandomHex(16);

// Check if secure random is available
if (isSecureRandomAvailable()) {
  console.log('Using cryptographically secure random generation');
} else {
  console.log('Using fallback random generation - consider installing expo-crypto');
}
```

## React Native Setup

To get secure random number generation on React Native, install expo-crypto:

```bash
npm install expo-crypto
# or
yarn add expo-crypto
```

The SDK will automatically detect and use expo-crypto when available.

## Migration Notes

- `generateUniqueId()` and `generateCuid()` now use the improved secure random utilities
- Existing APIs remain compatible
- No breaking changes to public APIs
- Better security on React Native when expo-crypto is available

## Security Considerations

- **Node.js**: Always uses cryptographically secure random generation
- **React Native with expo-crypto**: Uses secure random generation
- **React Native without expo-crypto**: Uses Math.random() fallback (not cryptographically secure)
- The SDK logs warnings when falling back to insecure random generation

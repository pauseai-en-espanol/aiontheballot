// Tests only: lets a child process run the API's TypeScript sources as they are (Node strips the types), resolving
// `./x.js` to `./x.ts` where only the source exists, as the build would after compiling.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && specifier.endsWith('.js')) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});

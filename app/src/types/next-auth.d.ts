import type { DefaultSession } from 'next-auth'

// Role carried through the credentials flow → JWT → session. 'owner' is full
// access; 'accountant' is read-only (enforced centrally in src/proxy.ts).
// Tokens minted before the role existed have no `role` claim and are treated
// as 'owner' (only owners existed before invites shipped).
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: 'owner' | 'accountant'
    } & DefaultSession['user']
  }

  interface User {
    role?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: string
  }
}

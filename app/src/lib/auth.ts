import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { TOTP } from 'otpauth'
import prisma from '@/lib/prisma'

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totpCode: { label: 'TOTP Code', type: 'text' },
        webauthnToken: { label: 'WebAuthn Token', type: 'text' },
      },
      async authorize(credentials) {
        // Passkey sign-in: a one-time token issued after a verified WebAuthn
        // assertion stands in for the password/TOTP checks.
        if (credentials?.webauthnToken) {
          const token = credentials.webauthnToken as string
          const record = await prisma.webauthnLoginToken.findUnique({
            where: { token },
          })
          if (!record) return null
          // Single-use: consume it regardless of validity.
          await prisma.webauthnLoginToken.delete({ where: { token } })
          if (record.expiresAt < new Date()) return null

          const user = await prisma.user.findUnique({
            where: { id: record.userId },
          })
          if (!user) return null
          return { id: user.id, name: user.name, email: user.email, role: user.role }
        }

        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = credentials.email as string
        const password = credentials.password as string
        const totpCode = (credentials.totpCode as string) || ''

        const user = await prisma.user.findUnique({
          where: { email },
        })

        if (!user) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(password, user.hashedPassword)

        if (!isPasswordValid) {
          return null
        }

        // If TOTP is enabled, validate the code
        if (user.totpEnabled && user.totpSecret) {
          if (!totpCode) {
            // Signal that TOTP is required — return null with a special marker
            // NextAuth will treat this as CredentialsSignin error
            // We use a custom error page approach instead
            throw new Error('TOTP_REQUIRED')
          }

          const totp = new TOTP({
            secret: user.totpSecret,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
          })

          const delta = totp.validate({ token: totpCode, window: 1 })
          if (delta === null) {
            throw new Error('TOTP_INVALID')
          }
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role ?? 'owner'
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        // Tokens minted before roles existed carry no claim → 'owner' (only
        // owners existed then). The proxy applies the same default.
        session.user.role = token.role === 'accountant' ? 'accountant' : 'owner'
      }
      return session
    },
  },
})

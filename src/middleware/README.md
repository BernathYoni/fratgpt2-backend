# Admin Middleware

## Overview

The `requireAdmin` middleware ensures that only users with the `ADMIN` role can access protected endpoints.

## Usage

### In Route Handlers

```typescript
import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/requireAdmin';

export async function adminRoutes(server: FastifyInstance) {
  // Admin-only endpoint
  server.get('/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
    // Only admins can access this
    const users = await prisma.user.findMany();
    return reply.send({ users });
  });

  // Multiple middleware (auth + admin)
  server.delete('/admin/users/:id', { preHandler: requireAdmin }, async (request, reply) => {
    // Delete user logic here
    return reply.send({ success: true });
  });
}
```

### Register Routes in Server

```typescript
// In src/server.ts
import { adminRoutes } from './routes/admin';

await server.register(adminRoutes, { prefix: '/admin' });
```

## Setting Up Admin Users

### 1. Register the account normally
First, create the account at https://fratgpt.co/register or via API:

```bash
curl -X POST https://api.fratgpt.co/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"Bernath.yoni@gmail.com","password":"yourpassword"}'
```

### 2. Run the admin script
Promote the user to ADMIN:

```bash
cd backend
npx tsx src/scripts/set-admin.ts
```

Expected output:
```
[SET-ADMIN] 🔧 Starting admin setup...
[SET-ADMIN] Target email: Bernath.yoni@gmail.com
[SET-ADMIN] 🔄 Updating user role from USER to ADMIN...
[SET-ADMIN] ✅ Successfully promoted user to ADMIN!
```

### 3. Verify admin access
Login and test an admin endpoint:

```bash
# Login to get token
TOKEN=$(curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"Bernath.yoni@gmail.com","password":"yourpassword"}' \
  | jq -r '.token')

# Test admin endpoint
curl -X GET http://localhost:3000/admin/users \
  -H "Authorization: Bearer $TOKEN"
```

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "code": "AUTH_FAILED"
}
```
**Cause:** Missing or invalid JWT token

### 403 Forbidden
```json
{
  "error": "Forbidden: Admin access required",
  "code": "ADMIN_REQUIRED"
}
```
**Cause:** Valid user but not an admin (role is USER, not ADMIN)

### 401 User Not Found
```json
{
  "error": "User not found",
  "code": "USER_NOT_FOUND"
}
```
**Cause:** JWT is valid but user was deleted from database

## Database Schema

The middleware relies on the `User.role` field:

```prisma
model User {
  id               String   @id @default(uuid())
  email            String   @unique
  passwordHash     String
  role             UserRole @default(USER)  // 👈 This field
  // ...
}

enum UserRole {
  USER
  ADMIN
}
```

## Security Notes

1. **Always use HTTPS in production** - JWT tokens in headers can be intercepted over HTTP
2. **Rotate JWT_SECRET regularly** - Invalidates all existing tokens
3. **Monitor admin actions** - Log all admin endpoint access
4. **Limit admin count** - Only promote trusted users
5. **No public admin registration** - Admins must be manually promoted via script

## Common Admin Endpoints

Here are typical admin-only endpoints you might create:

```typescript
// User management
GET    /admin/users              - List all users
GET    /admin/users/:id          - Get user details
DELETE /admin/users/:id          - Delete user
PATCH  /admin/users/:id/role     - Change user role

// Usage analytics
GET    /admin/usage/stats        - Platform-wide usage stats
GET    /admin/usage/top-users    - Most active users

// Subscription management
GET    /admin/subscriptions      - All subscriptions
POST   /admin/subscriptions/:id/cancel - Force cancel subscription

// System health
GET    /admin/health             - System metrics
GET    /admin/logs               - Recent error logs
```

## Example: Complete Admin Route File

```typescript
// backend/src/routes/admin.ts
import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/requireAdmin';
import { prisma } from '../db/client';

export async function adminRoutes(server: FastifyInstance) {
  // All routes in this file require admin
  server.addHook('preHandler', requireAdmin);

  // List all users
  server.get('/users', async (request, reply) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        subscriptions: {
          where: { status: 'ACTIVE' },
          select: { plan: true },
        },
      },
    });

    return reply.send({ users });
  });

  // Platform stats
  server.get('/stats', async (request, reply) => {
    const [totalUsers, totalSessions, totalMessages] = await Promise.all([
      prisma.user.count(),
      prisma.chatSession.count(),
      prisma.message.count(),
    ]);

    return reply.send({
      totalUsers,
      totalSessions,
      totalMessages,
    });
  });
}
```

Then register in `server.ts`:
```typescript
import { adminRoutes } from './routes/admin';

await server.register(adminRoutes, { prefix: '/admin' });
```

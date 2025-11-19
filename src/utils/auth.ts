import bcrypt from 'bcrypt';
import { FastifyRequest } from 'fastify';

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function authenticate(request: FastifyRequest): Promise<{ userId: string }> {
  try {
    const payload = await request.jwtVerify<{ userId: string }>();
    return { userId: payload.userId };
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

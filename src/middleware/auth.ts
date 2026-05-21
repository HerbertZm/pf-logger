import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma';

export interface AuthenticatedRequest extends Request {
  user: {
    id: number;
    username: string;
    role: string;
    isActive: boolean;
  };
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const session = await prisma.appSession.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date() || !session.user.isActive) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    (req as AuthenticatedRequest).user = {
      id: session.user.id,
      username: session.user.username,
      role: session.user.role,
      isActive: session.user.isActive,
    };

    next();
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function requireSuperadmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;
  if (user.role !== 'superadmin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

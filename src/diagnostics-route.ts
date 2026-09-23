import type { Express, Request, Response } from 'express';
import { buildDiagnosticsReport } from './diagnostics.js';

/**
 * Registers the local dashboard diagnostics endpoint.
 *
 * This module intentionally does not expose credentials, tokens, tunnel ids,
 * or private filesystem information. It is designed to be mounted by app.ts
 * after the local admin authentication middleware.
 */
export function registerDiagnosticsRoute(app: Express, deps: {
  getDiagnostics: () => Promise<ReturnType<typeof buildDiagnosticsReport>>;
}) {
  app.get('/api/diagnostics', async (_req: Request, res: Response) => {
    try {
      res.json(await deps.getDiagnostics());
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: String(error?.message ?? error).slice(0, 200)
      });
    }
  });
}

import type { Express, Request, Response } from 'express';
import type { DiagnosticsReport } from './diagnostics.js';

/**
 * Registers the local dashboard diagnostics endpoint.
 *
 * This module intentionally does not expose credentials, tokens, tunnel ids,
 * or private filesystem information. It is designed to be mounted by app.ts
 * after the local admin authentication middleware.
 */
export function registerDiagnosticsRoute(app: Express, deps: {
  getDiagnostics: (force?: boolean) => Promise<DiagnosticsReport>;
}) {
  app.get('/api/diagnostics', async (req: Request, res: Response) => {
    try {
      res.json(await deps.getDiagnostics(req.query.refresh === '1'));
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: String(error?.message ?? error).slice(0, 200)
      });
    }
  });
}

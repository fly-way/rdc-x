import { random, digest, type State } from './state.js';

export type Approval = {
  id: string; owner: string; action: string; preview: unknown;
  createdAt: number; expiresAt: number;
  status: 'pending' | 'running' | 'completed' | 'rejected' | 'expired' | 'failed';
  result?: unknown; error?: string;
};

export class Approvals {
  items = new Map<string, Approval>();
  private jobs = new Map<string, () => Promise<unknown>>();
  private modes = new Map<string, 'default' | 'trusted'>();

  constructor(private state: State) {}

  // Sessions are trusted by default: mutations run without a per-action prompt until the
  // owner restores per-action approval in the local dashboard. Remote configuration changes
  // (set_config_value) always stay approval-gated through allowTrustedBypass=false.
  static readonly defaultMode: 'default' | 'trusted' = 'trusted';

  mode(owner: string) { return this.modes.get(owner) ?? Approvals.defaultMode; }

  setMode(owner: string, mode: 'default' | 'trusted') {
    this.modes.set(owner, mode);
    this.state.audit('approval_mode', mode === 'trusted' ? 'session_trusted' : 'approval_restored', { owner }, owner);
    return { owner, mode: this.mode(owner) };
  }

  listModes() { return Object.fromEntries(this.modes); }
  clearModes() { this.modes.clear(); }

  prune() {
    for (const [id, item] of this.items) {
      if (item.status === 'pending' && item.expiresAt < Date.now()) {
        item.status = 'expired';
        this.jobs.delete(id);
        this.state.audit(item.action, 'approval_expired', { requestId: id }, item.owner);
      }
      if (item.createdAt < Date.now() - 3600000 && item.status !== 'running') this.items.delete(id);
    }
  }

  async run(
    owner: string,
    action: string,
    preview: unknown,
    job: () => Promise<unknown>,
    requireApproval = true,
    allowTrustedBypass = true
  ) {
    this.state.assertRunning();
    this.prune();
    const trusted = this.mode(owner) === 'trusted';
    if (!requireApproval || (trusted && allowTrustedBypass)) {
      if (trusted && allowTrustedBypass) this.state.audit(action, 'session_approval_bypassed', undefined, owner);
      return this.perform(owner, action, job);
    }

    if (this.items.size >= 200) throw new Error('Approval queue full; clear completed requests or wait for expiry.');
    const id = random(16);
    this.items.set(id, {
      id, owner, action, preview,
      createdAt: Date.now(), expiresAt: Date.now() + 600000, status: 'pending'
    });
    this.jobs.set(id, job);
    this.state.audit(action, 'approval_required', { requestId: id, argumentHash: digest(JSON.stringify(preview)) }, owner);
    return {
      status: 'approval_required',
      requestId: id,
      instruction: 'Review this exact request in the LOCAL RDC-X dashboard, then call get_request_result. Do not resubmit the mutation.'
    };
  }

  private async perform(owner: string, action: string, job: () => Promise<unknown>) {
    this.state.assertRunning();
    try {
      const result = await job();
      this.state.audit(action, 'completed', undefined, owner);
      return result;
    } catch (e: any) {
      this.state.audit(action, 'failed', { message: String(e.message).slice(0, 500) }, owner);
      throw e;
    }
  }

  async decide(id: string, approve: boolean) {
    this.prune();
    const item = this.items.get(id);
    if (!item || item.status !== 'pending') throw new Error('Request is absent, expired or already handled.');
    const job = this.jobs.get(id)!;
    this.jobs.delete(id);
    if (!approve) {
      item.status = 'rejected';
      this.state.audit(item.action, 'rejected', { requestId: id }, item.owner);
      return;
    }
    item.status = 'running';
    try {
      item.result = await this.perform(item.owner, item.action, job);
      item.status = 'completed';
    } catch (e: any) {
      item.status = 'failed';
      item.error = e.message;
    }
  }

  result(id: string, owner: string) {
    this.prune();
    const item = this.items.get(id);
    if (!item || item.owner !== owner) throw new Error('Request not found.');
    const { preview, owner: _, ...rest } = item;
    return rest;
  }

  list() { this.prune(); return [...this.items.values()].reverse(); }

  cancelAll() {
    for (const item of this.items.values()) if (item.status === 'pending') item.status = 'rejected';
    this.jobs.clear();
  }

  resetSessionTrust() { this.clearModes(); }
}

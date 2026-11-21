-- P0 durable resumable checkpoints, no customer or provider secrets.
create table if not exists public.ibuild_agent_checkpoints_v1 (
 run_id text primary key,
 phase text not null check(phase in ('P0','P1','P2','P3')),
 gate_state text not null check(gate_state in ('BLOCKED','PARTIAL','PASSED')),
 state text not null check(state in ('RUNNING','WAITING_HUMAN','WAITING_EXTERNAL','UNCERTAIN','SUCCEEDED','FAILED')),
 last_checkpoint_at timestamptz not null default now(),
 heartbeat_at timestamptz,
 last_progress_at timestamptz not null default now(),
 baseline_ref text,
 deployed_ref text,
 rollback_ref text,
 next_action text not null,
 evidence jsonb not null default '{}'::jsonb
);
alter table public.ibuild_agent_checkpoints_v1 enable row level security;
revoke all on public.ibuild_agent_checkpoints_v1 from public, anon, authenticated;
grant select,insert,update on public.ibuild_agent_checkpoints_v1 to service_role;
comment on table public.ibuild_agent_checkpoints_v1 is 'iBuild private agent resume checkpoint. No secrets, customer data or fake worker heartbeat.';

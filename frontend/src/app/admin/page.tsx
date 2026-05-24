'use client';

import { useEffect, useState } from 'react';
import { apiFetch, getApiUrl } from '@/lib/api';
import { Button, Card, Input, SectionLabel, ThemeToggle } from '@/components/ui';
import { getSocketClient } from '@/lib/socket';
import {
  SERVER_EVENTS,
  type AdminProblemReport,
  type ProblemReportReason,
  type ProblemReportStatus,
  type RaceSnapshotEvent,
  type SessionInfo,
} from '@/lib/types';

type HealthStatus = {
  state: 'idle' | 'loading' | 'ok' | 'error';
  payload: Record<string, unknown> | null;
  error: string | null;
  updatedAt: string | null;
};

type SocketStatus = {
  connected: boolean;
  socketId: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

type EventSnapshot<T> = {
  payload: T | null;
  updatedAt: string | null;
};

const REPORT_STATUS_OPTIONS: ProblemReportStatus[] = ['OPEN', 'REVIEWED', 'RESOLVED', 'DISMISSED'];
const REPORT_REASON_OPTIONS: Array<ProblemReportReason | 'ALL'> = [
  'ALL',
  'WRONG_ANSWER',
  'BAD_EXPLANATION',
  'UNCLEAR_QUESTION',
  'TELEMETRY_MISMATCH',
  'OTHER',
];

function nowIso(): string {
  return new Date().toISOString();
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Not yet';

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function StatusBadge({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'error' | 'muted' }) {
  const toneClass =
    tone === 'ok'
      ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)]'
      : tone === 'warn'
        ? 'border-[var(--color-border)] bg-[var(--color-muted)]'
        : tone === 'error'
          ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_92%)] text-[var(--color-accent)]'
          : 'border-[var(--color-border)] bg-[var(--color-bg)]';

  return (
    <span className={`border-2 px-3 py-1 font-display text-xs uppercase tracking-[0.18em] ${toneClass}`}>
      {label}
    </span>
  );
}

export default function AdminPage() {
  const socket = getSocketClient();
  const backendUrl = getApiUrl('');

  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [reports, setReports] = useState<AdminProblemReport[]>([]);
  const [statusFilter, setStatusFilter] = useState<ProblemReportStatus | 'ALL'>('ALL');
  const [reasonFilter, setReasonFilter] = useState<ProblemReportReason | 'ALL'>('ALL');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportActionError, setReportActionError] = useState<string | null>(null);
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [health, setHealth] = useState<HealthStatus>({
    state: 'idle',
    payload: null,
    error: null,
    updatedAt: null,
  });
  const [socketStatus, setSocketStatus] = useState<SocketStatus>({
    connected: socket.isConnected(),
    socketId: socket.getSocketId() ?? null,
    lastError: socket.getLastError()?.message ?? null,
    updatedAt: null,
  });
  const [sessions, setSessions] = useState<EventSnapshot<SessionInfo[]>>({
    payload: null,
    updatedAt: null,
  });
  const [feedStatus, setFeedStatus] = useState<EventSnapshot<{ stalled: boolean }>>({
    payload: null,
    updatedAt: null,
  });
  const [snapshot, setSnapshot] = useState<EventSnapshot<RaceSnapshotEvent>>({
    payload: null,
    updatedAt: null,
  });

  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null;
  const filteredReports = reports.filter((report) => {
    const matchesStatus = statusFilter === 'ALL' || report.status === statusFilter;
    const matchesReason = reasonFilter === 'ALL' || report.reason === reasonFilter;
    return matchesStatus && matchesReason;
  });

  useEffect(() => {
    let active = true;

    const loadReports = async () => {
      try {
        const response = await apiFetch('/admin/reports');
        if (!active) return;

        if (response.status === 401) {
          setIsAuthenticated(false);
          return;
        }

        const data = (await response.json()) as { reports: AdminProblemReport[] };
        setReports(data.reports ?? []);
        setSelectedReportId((current) => current ?? data.reports?.[0]?.id ?? null);
        setIsAuthenticated(true);
      } catch (error) {
        if (!active) return;
        setLoginError((error as Error).message);
        setIsAuthenticated(false);
      }
    };

    void loadReports();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    let active = true;

    const runHealthCheck = async () => {
      setHealth((current) => ({ ...current, state: 'loading', error: null }));

      try {
        const response = await fetch(getApiUrl('/health'), { cache: 'no-store' });
        const payload = (await response.json()) as Record<string, unknown>;
        if (!active) return;

        setHealth({
          state: response.ok ? 'ok' : 'error',
          payload,
          error: response.ok ? null : `HTTP ${response.status}`,
          updatedAt: nowIso(),
        });
      } catch (error) {
        if (!active) return;

        setHealth({
          state: 'error',
          payload: null,
          error: (error as Error).message,
          updatedAt: nowIso(),
        });
      }
    };

    socket.connect();
    void runHealthCheck();
    socket.getSessions(new Date().getFullYear());

    const unsubscribers = [
      socket.on('connected', () => {
        setSocketStatus({
          connected: true,
          socketId: socket.getSocketId() ?? null,
          lastError: null,
          updatedAt: nowIso(),
        });
      }),
      socket.on('disconnected', () => {
        setSocketStatus((current) => ({
          ...current,
          connected: false,
          socketId: null,
          updatedAt: nowIso(),
        }));
      }),
      socket.on(SERVER_EVENTS.SESSIONS_LIST, (payload: SessionInfo[]) => {
        setSessions({ payload, updatedAt: nowIso() });
      }),
      socket.on(SERVER_EVENTS.FEED_STATUS, (payload: { stalled: boolean }) => {
        setFeedStatus({ payload, updatedAt: nowIso() });
      }),
      socket.on(SERVER_EVENTS.RACE_SNAPSHOT_UPDATE, (payload: RaceSnapshotEvent) => {
        setSnapshot({ payload, updatedAt: nowIso() });
      }),
      socket.on(SERVER_EVENTS.ERROR, (payload: { message: string }) => {
        setSocketStatus({
          connected: socket.isConnected(),
          socketId: socket.getSocketId() ?? null,
          lastError: payload.message,
          updatedAt: nowIso(),
        });
      }),
    ];

    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [isAuthenticated, socket]);

  const loadReports = async () => {
    const response = await apiFetch('/admin/reports');
    if (response.status === 401) {
      setIsAuthenticated(false);
      return;
    }

    const data = (await response.json()) as { reports: AdminProblemReport[] };
    setReports(data.reports ?? []);
    setSelectedReportId((current) => {
      if (current && data.reports.some((report) => report.id === current)) {
        return current;
      }

      return data.reports?.[0]?.id ?? null;
    });
    setIsAuthenticated(true);
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await apiFetch('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data.message ?? 'Login failed');
      }

      setPassword('');
      await loadReports();
    } catch (error) {
      setLoginError((error as Error).message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await apiFetch('/admin/logout', { method: 'POST' });
    setIsAuthenticated(false);
    setReports([]);
    setSelectedReportId(null);
  };

  const handleStatusChange = async (reportId: string, status: ProblemReportStatus) => {
    setChangingStatusId(reportId);
    setReportActionError(null);

    try {
      const response = await apiFetch(`/admin/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to update report');
      }

      await loadReports();
    } catch (error) {
      setReportActionError((error as Error).message);
    } finally {
      setChangingStatusId(null);
    }
  };

  const handleChangePassword = async () => {
    setIsChangingPassword(true);
    setPasswordError(null);
    setPasswordMessage(null);

    try {
      const response = await apiFetch('/admin/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to change password');
      }

      setPasswordMessage('Password changed. Sign in again with the new password.');
      setCurrentPassword('');
      setNewPassword('');
      setIsAuthenticated(false);
      setReports([]);
      setSelectedReportId(null);
    } catch (error) {
      setPasswordError((error as Error).message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleRefresh = async () => {
    setReportActionError(null);
    await loadReports();

    setHealth((current) => ({ ...current, state: 'loading', error: null }));
    try {
      const response = await fetch(getApiUrl('/health'), { cache: 'no-store' });
      const payload = (await response.json()) as Record<string, unknown>;
      setHealth({
        state: response.ok ? 'ok' : 'error',
        payload,
        error: response.ok ? null : `HTTP ${response.status}`,
        updatedAt: nowIso(),
      });
    } catch (error) {
      setHealth({
        state: 'error',
        payload: null,
        error: (error as Error).message,
        updatedAt: nowIso(),
      });
    }

    socket.connect();
    socket.getSessions(new Date().getFullYear());
    setSocketStatus({
      connected: socket.isConnected(),
      socketId: socket.getSocketId() ?? null,
      lastError: socket.getLastError()?.message ?? null,
      updatedAt: nowIso(),
    });
  };

  if (!isAuthenticated) {
    return (
      <main className="app-shell swiss-noise relative">
        <div className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-6 md:px-8">
          <Card tone="default" className="w-full">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SectionLabel index="05" label="Admin Access" />
                <h1 className="mt-2 font-display text-4xl uppercase leading-none tracking-tight md:text-5xl">
                  Control Room
                </h1>
                <p className="mt-3 font-body text-sm text-[var(--color-muted-fg)]">
                  Sign in to review reported problems and access the diagnostics console.
                </p>
              </div>
              <ThemeToggle />
            </div>

            <div className="mt-6 grid gap-4">
              <Input
                id="admin-password"
                label="Admin Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter shared admin password"
              />
              {loginError && (
                <p className="font-display text-xs uppercase tracking-[0.16em] text-[var(--color-accent)]">
                  {loginError}
                </p>
              )}
              {passwordMessage && (
                <p className="font-display text-xs uppercase tracking-[0.16em] text-[var(--color-accent)]">
                  {passwordMessage}
                </p>
              )}
              <Button onClick={handleLogin} disabled={isLoggingIn || !password.trim()} className="w-full">
                {isLoggingIn ? 'Signing In…' : 'Enter Admin Panel'}
              </Button>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell swiss-noise relative">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 lg:py-10">
        <header className="border-2 border-[var(--color-border)] bg-[var(--color-muted)] p-6 md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <SectionLabel index="05" label="Admin Panel" />
              <h1 className="mt-2 font-display text-4xl uppercase leading-none tracking-tight md:text-6xl">
                Reports + Diagnostics
              </h1>
              <p className="mt-4 max-w-3xl border-l-4 border-[var(--color-accent)] pl-4 font-body text-sm text-[var(--color-muted-fg)] md:text-base">
                Review player-reported AI issues, monitor backend health, and keep the live telemetry pipeline visible in one place.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ThemeToggle />
              <Button variant="secondary" onClick={handleRefresh}>
                Refresh
              </Button>
              <Button variant="ghost" onClick={handleLogout}>
                Logout
              </Button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <StatusBadge label={`${reports.length} Reports`} tone={reports.length > 0 ? 'warn' : 'muted'} />
            <StatusBadge
              label={health.state === 'ok' ? 'Backend Healthy' : health.state === 'loading' ? 'Health Checking' : 'Backend Check Failed'}
              tone={health.state === 'ok' ? 'ok' : health.state === 'loading' ? 'warn' : 'error'}
            />
            <StatusBadge
              label={socketStatus.connected ? 'Socket Connected' : 'Socket Disconnected'}
              tone={socketStatus.connected ? 'ok' : 'warn'}
            />
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
          <Card tone="default" className="p-6">
            <SectionLabel index="06" label="Report Inbox" className="mb-4" />
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">
                    Status
                  </span>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as ProblemReportStatus | 'ALL')}
                    className="h-12 w-full border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-4 font-display text-sm uppercase focus-visible:border-[var(--color-accent)] focus-visible:outline-none"
                  >
                    <option value="ALL">All Statuses</option>
                    {REPORT_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">
                    Reason
                  </span>
                  <select
                    value={reasonFilter}
                    onChange={(event) => setReasonFilter(event.target.value as ProblemReportReason | 'ALL')}
                    className="h-12 w-full border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-4 font-display text-sm uppercase focus-visible:border-[var(--color-accent)] focus-visible:outline-none"
                  >
                    {REPORT_REASON_OPTIONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason === 'ALL' ? 'All Reasons' : reason.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-3">
                {filteredReports.length > 0 ? (
                  filteredReports.map((report) => (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => setSelectedReportId(report.id)}
                      className={`w-full border-2 p-4 text-left transition-colors ${
                        selectedReport?.id === report.id
                          ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_90%)]'
                          : 'border-[var(--color-border)] bg-[var(--color-bg)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-sm uppercase leading-tight">{report.reason.replaceAll('_', ' ')}</p>
                          <p className="mt-1 font-body text-sm text-[var(--color-muted-fg)]">
                            {report.username} · Lobby {report.lobbyCode}
                          </p>
                        </div>
                        <StatusBadge label={report.status} tone={report.status === 'OPEN' ? 'warn' : 'ok'} />
                      </div>
                      <p className="mt-3 font-body text-sm">
                        {report.questionText ?? 'Question text unavailable'}
                      </p>
                      <p className="mt-3 font-display text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">
                        {formatTimestamp(report.createdAt)}
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="border-2 border-[var(--color-border)] bg-[var(--color-bg)] p-4 font-display text-xs uppercase tracking-[0.16em] text-[var(--color-muted-fg)]">
                    No reports match the current filters.
                  </p>
                )}
              </div>
            </div>
          </Card>

          <div className="grid gap-6">
            <Card tone="default" className="p-6">
              <SectionLabel index="07" label="Report Detail" className="mb-4" />
              {selectedReport ? (
                <div className="grid gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={selectedReport.status} tone={selectedReport.status === 'OPEN' ? 'warn' : 'ok'} />
                    <StatusBadge label={selectedReport.reason.replaceAll('_', ' ')} tone="muted" />
                  </div>
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Question</p>
                    <p className="mt-2 font-body text-sm">{selectedReport.questionText ?? 'Question text unavailable'}</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Reporter</p>
                      <p className="mt-2 font-body text-sm">{selectedReport.username}</p>
                    </div>
                    <div>
                      <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Lobby</p>
                      <p className="mt-2 font-body text-sm">{selectedReport.lobbyCode}</p>
                    </div>
                    <div>
                      <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Correct Answer</p>
                      <p className="mt-2 font-body text-sm">{selectedReport.correctAnswer ?? 'Unknown'}</p>
                    </div>
                    <div>
                      <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Player Answer</p>
                      <p className="mt-2 font-body text-sm">{selectedReport.reportedAnswer ?? 'No answer submitted'}</p>
                    </div>
                  </div>
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Explanation Snapshot</p>
                    <p className="mt-2 font-body text-sm leading-relaxed">{selectedReport.explanation ?? 'No explanation saved'}</p>
                  </div>
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Player Note</p>
                    <p className="mt-2 font-body text-sm">{selectedReport.note ?? 'No note added'}</p>
                  </div>
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Review Actions</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {REPORT_STATUS_OPTIONS.map((status) => (
                        <Button
                          key={status}
                          size="sm"
                          variant={selectedReport.status === status ? 'primary' : 'secondary'}
                          disabled={changingStatusId === selectedReport.id && selectedReport.status !== status}
                          onClick={() => handleStatusChange(selectedReport.id, status)}
                        >
                          {status}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <p className="font-display text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">
                    Created {formatTimestamp(selectedReport.createdAt)} · Updated {formatTimestamp(selectedReport.updatedAt)}
                  </p>
                  {reportActionError && (
                    <p className="font-display text-xs uppercase tracking-[0.16em] text-[var(--color-accent)]">
                      {reportActionError}
                    </p>
                  )}
                </div>
              ) : (
                <p className="font-body text-sm text-[var(--color-muted-fg)]">Select a report to inspect it.</p>
              )}
            </Card>

            <Card tone="default" className="p-6">
              <SectionLabel index="08" label="Password" className="mb-4" />
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  id="current-password"
                  label="Current Password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <Input
                  id="new-password"
                  label="New Password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="font-body text-sm text-[var(--color-muted-fg)]">
                  Changing the password signs the current admin session out immediately.
                </p>
                <Button
                  onClick={handleChangePassword}
                  disabled={isChangingPassword || !currentPassword.trim() || !newPassword.trim()}
                >
                  {isChangingPassword ? 'Updating…' : 'Change Password'}
                </Button>
              </div>
              {passwordError && (
                <p className="mt-3 font-display text-xs uppercase tracking-[0.16em] text-[var(--color-accent)]">
                  {passwordError}
                </p>
              )}
            </Card>

            <section className="grid gap-6 lg:grid-cols-2">
              <Card tone="default" className="p-6">
                <SectionLabel index="09" label="Backend Health" className="mb-4" />
                <div className="space-y-4">
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Backend URL</p>
                    <p className="mt-2 break-all font-body text-sm">{backendUrl || getApiUrl('/')}</p>
                  </div>
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Last Updated</p>
                    <p className="mt-2 font-body text-sm">{formatTimestamp(health.updatedAt)}</p>
                  </div>
                  <pre className="overflow-x-auto border-2 border-[var(--color-border)] bg-[var(--color-bg)] p-4 font-mono text-xs leading-6 whitespace-pre-wrap">
                    {health.error
                      ? `Error: ${health.error}`
                      : JSON.stringify(health.payload ?? { status: 'pending' }, null, 2)}
                  </pre>
                </div>
              </Card>

              <Card tone="default" className="p-6">
                <SectionLabel index="10" label="Socket Transport" className="mb-4" />
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Connection</p>
                      <p className="mt-2 font-body text-sm">{socketStatus.connected ? 'Connected' : 'Disconnected'}</p>
                    </div>
                    <div>
                      <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Socket ID</p>
                      <p className="mt-2 break-all font-body text-sm">{socketStatus.socketId ?? 'Unavailable'}</p>
                    </div>
                  </div>
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Latest Error</p>
                    <p className="mt-2 font-body text-sm">{socketStatus.lastError ?? 'None'}</p>
                  </div>
                </div>
              </Card>

              <Card tone="default" className="p-6">
                <SectionLabel index="11" label="Session Probe" className="mb-4" />
                <pre className="overflow-x-auto border-2 border-[var(--color-border)] bg-[var(--color-bg)] p-4 font-mono text-xs leading-6 whitespace-pre-wrap">
                  {JSON.stringify(
                    (sessions.payload ?? []).slice(0, 3).map((session) => ({
                      session_name: session.session_name,
                      year: session.year,
                      location: session.location,
                      mode: session.mode,
                      isCompleted: session.isCompleted,
                    })),
                    null,
                    2
                  )}
                </pre>
                <p className="mt-2 font-body text-xs text-[var(--color-muted-fg)]">
                  Updated {formatTimestamp(sessions.updatedAt)}
                </p>
              </Card>

              <Card tone="default" className="p-6">
                <SectionLabel index="12" label="Realtime Signals" className="mb-4" />
                <div className="space-y-4">
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Feed Status</p>
                    <p className="mt-2 font-body text-sm">
                      {feedStatus.payload ? (feedStatus.payload.stalled ? 'Stalled' : 'Healthy') : 'Awaiting event'}
                    </p>
                    <p className="mt-1 font-body text-xs text-[var(--color-muted-fg)]">
                      Updated {formatTimestamp(feedStatus.updatedAt)}
                    </p>
                  </div>
                  <pre className="overflow-x-auto border-2 border-[var(--color-border)] bg-[var(--color-bg)] p-4 font-mono text-xs leading-6 whitespace-pre-wrap">
                    {JSON.stringify(
                      snapshot.payload
                        ? {
                            lapNumber: snapshot.payload.lapNumber,
                            trackStatus: snapshot.payload.trackStatus,
                            sessionMode: snapshot.payload.sessionMode,
                            replaySpeed: snapshot.payload.replaySpeed,
                            isReplayComplete: snapshot.payload.isReplayComplete,
                            leader: snapshot.payload.leader,
                            topThree: snapshot.payload.topThree,
                          }
                        : { status: 'Awaiting event' },
                      null,
                      2
                    )}
                  </pre>
                </div>
              </Card>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
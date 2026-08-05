import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  Copy,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import type { McpGrant, McpSettingsInfo } from '@shared/types'
import { LoadingBlock } from '../../components/feedback'
import { SettingRow, Switch } from '../../components/form'
import { Tooltip, confirm } from '../../components/overlay'
import { Badge, Button, IconButton } from '../../components/primitives'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { fullTime } from '../../lib/time'
import { useUi } from '../../store/ui'

type BusyAction = 'global' | 'write' | 'trash' | 'revoke' | null

export function McpSettings() {
  const toast = useUi((state) => state.toast)
  const [info, setInfo] = useState<McpSettingsInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const busyRef = useRef<BusyAction>(null)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const next = await api.mcp.get()
      if (mountedRef.current) setInfo(next)
    } catch (error) {
      if (mountedRef.current) setLoadError(errorMessage(error))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
    }
  }, [])

  const begin = (action: Exclude<BusyAction, null>): boolean => {
    if (busyRef.current) return false
    busyRef.current = action
    setBusy(action)
    return true
  }

  const finish = () => {
    busyRef.current = null
    if (mountedRef.current) setBusy(null)
  }

  const fail = (error: unknown) => {
    toast({
      title: t('common.action_failed'),
      description: errorMessage(error),
      tone: 'danger',
    })
  }

  const savePreference = async (
    action: Exclude<BusyAction, null>,
    body: Parameters<typeof api.mcp.save>[0],
    successTitle = t('settings.mcp_updated'),
  ): Promise<boolean> => {
    if (!begin(action)) return false
    try {
      const result = await api.mcp.save(body)
      if (mountedRef.current) {
        setInfo((current) => current && ({
          ...current,
          enabled: result.enabled,
          preferences: result.preferences,
        }))
      }
      toast({
        title: successTitle,
        description: result.reconnectRequired ? t('settings.mcp_reconnect_notice') : undefined,
        tone: 'success',
      })
      return true
    } catch (error) {
      fail(error)
      return false
    } finally {
      finish()
    }
  }

  const revoke = async (grant: McpGrant) => {
    const approved = await confirm({
      title: t('settings.mcp_revoke_title'),
      description: t('settings.mcp_revoke_desc', { name: grant.clientName }),
      confirmLabel: t('settings.mcp_revoke'),
      tone: 'danger',
    })
    if (!approved || !begin('revoke')) return
    try {
      await api.mcp.revokeGrant(grant.id)
      if (mountedRef.current) {
        setInfo((current) => current && ({
          ...current,
          grants: current.grants.filter((item) => item.id !== grant.id),
        }))
      }
      toast({ title: t('settings.mcp_grant_revoked'), tone: 'success' })
    } catch (error) {
      fail(error)
    } finally {
      finish()
    }
  }

  const revokeAll = async () => {
    const approved = await confirm({
      title: t('settings.mcp_revoke_all_title'),
      description: t('settings.mcp_revoke_all_desc'),
      confirmLabel: t('settings.mcp_revoke_all'),
      tone: 'danger',
    })
    if (!approved || !begin('revoke')) return
    try {
      const result = await api.mcp.revokeAllGrants()
      if (mountedRef.current) setInfo((current) => current && ({ ...current, grants: [] }))
      toast({ title: t('settings.mcp_revoked_count', { count: result.revoked }), tone: 'success' })
    } catch (error) {
      fail(error)
    } finally {
      finish()
    }
  }

  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(id)
      window.setTimeout(() => {
        if (mountedRef.current) setCopied((current) => current === id ? null : current)
      }, 1_800)
      toast({ title: t('settings.mcp_copied'), tone: 'success' })
    } catch (error) {
      fail(error)
    }
  }

  const snippets = useMemo(() => info ? clientSnippets(info) : [], [info])

  if (loading && !info) return <LoadingBlock label={t('settings.mcp_loading')} />
  if (!info) {
    return (
      <div className="rounded-[var(--r-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
        <p className="text-[12.5px] text-[var(--danger)]">{loadError ?? t('settings.mcp_load_failed')}</p>
        <Button className="mt-3" size="sm" icon={<RefreshCw size={12} />} onClick={() => void load()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  const preferences = info.preferences

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)]">
        <div className="flex items-start gap-3 p-4">
          <span className="mt-0.5 rounded-[var(--r-md)] bg-[var(--accent-soft)] p-2 text-[var(--accent)]">
            <Bot size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)]">{t('settings.mcp_private_knowledge')}</h3>
              <Badge tone={info.enabled ? 'success' : 'neutral'}>
                {info.enabled ? t('settings.enabled') : t('settings.mcp_disabled')}
              </Badge>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
              {t('settings.mcp_intro')}
            </p>
          </div>
        </div>
        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          <div className="mb-1 text-[11px] font-medium text-[var(--text-tertiary)]">{t('settings.mcp_endpoint')}</div>
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-[var(--r-sm)] bg-[var(--bg-inset)] px-2.5 py-2 text-[11.5px] text-[var(--text-secondary)]">
              {info.endpoint}
            </code>
            <Tooltip label={t('settings.mcp_copy')} side="left">
              <IconButton label={t('settings.mcp_copy')} size="sm" onClick={() => void copy('endpoint', info.endpoint)}>
                {copied === 'endpoint' ? <Check size={14} /> : <Copy size={14} />}
              </IconButton>
            </Tooltip>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--text-quaternary)]">
            {t('settings.mcp_endpoint_desc')}
          </p>
        </div>
      </section>

      <section>
        <h3 className="mb-1 px-1 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-quaternary)]">
          {t('settings.mcp_permissions')}
        </h3>
        {info.canManageGlobal && (
          <SettingRow title={t('settings.mcp_enable')} description={t('settings.mcp_enable_desc')}>
            <Switch
              checked={info.enabled}
              disabled={Boolean(busy)}
              label={t('settings.mcp_enable')}
              onChange={(enabled) => void savePreference('global', { enabled })}
            />
          </SettingRow>
        )}
        <SettingRow title={t('settings.mcp_write_access')} description={t('settings.mcp_write_access_desc')}>
          <Switch
            checked={preferences.writeEnabled}
            disabled={!info.enabled || Boolean(busy)}
            label={t('settings.mcp_write_access')}
            onChange={(writeEnabled) => void savePreference('write', { writeEnabled })}
          />
        </SettingRow>
        <SettingRow title={t('settings.mcp_trash_access')} description={t('settings.mcp_trash_access_desc')}>
          <Switch
            checked={preferences.trashEnabled}
            disabled={!info.enabled || Boolean(busy)}
            label={t('settings.mcp_trash_access')}
            onChange={(trashEnabled) => void savePreference('trash', { trashEnabled })}
          />
        </SettingRow>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-quaternary)]">
          {t('settings.mcp_connect_clients')}
        </h3>
        <p className="mb-3 px-1 text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
          {t('settings.mcp_connect_desc')}
        </p>
        <div className="space-y-2">
          {snippets.map((snippet) => (
            <details key={snippet.id} className="group overflow-hidden rounded-[var(--r-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-[12.5px] font-medium text-[var(--text-primary)]">
                <span>{snippet.name}</span>
                <span className="text-[10.5px] font-normal text-[var(--text-quaternary)]">{t('settings.mcp_transport')}</span>
              </summary>
              <div className="border-t border-[var(--border-subtle)] p-3">
                <div className="flex items-start gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--r-sm)] bg-[var(--bg-inset)] p-2.5 text-[10.5px] leading-relaxed text-[var(--text-secondary)]">{snippet.value}</pre>
                  <Tooltip label={t('settings.mcp_copy')} side="left">
                    <IconButton label={t('settings.mcp_copy')} size="sm" onClick={() => void copy(snippet.id, snippet.value)}>
                      {copied === snippet.id ? <Check size={14} /> : <Copy size={14} />}
                    </IconButton>
                  </Tooltip>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <h3 className="text-[11px] font-semibold tracking-[0.06em] text-[var(--text-quaternary)]">
            {t('settings.mcp_connected_clients')}
          </h3>
          {info.grants.length > 1 && (
            <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void revokeAll()}>
              {t('settings.mcp_revoke_all')}
            </Button>
          )}
        </div>
        {info.grants.length ? (
          <div className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)]">
            {info.grants.map((grant) => (
              <div key={grant.id} className="flex items-center gap-3 border-b border-[var(--border-subtle)] p-3.5 last:border-b-0">
                <span className="rounded-[var(--r-sm)] bg-[var(--bg-raised)] p-2 text-[var(--text-tertiary)]">
                  <ShieldCheck size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">{grant.clientName}</div>
                  <div className="mt-0.5 truncate text-[10.5px] text-[var(--text-quaternary)]">
                    {scopeSummary(grant.scopes)} · {t('settings.mcp_granted_at', { time: fullTime(grant.createdAt) })}
                  </div>
                </div>
                <Tooltip label={t('settings.mcp_revoke')} side="left">
                  <IconButton
                    label={t('settings.mcp_revoke')}
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => void revoke(grant)}
                  >
                    <Unplug size={14} />
                  </IconButton>
                </Tooltip>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[var(--r-lg)] border border-dashed border-[var(--border-default)] p-5 text-center text-[11.5px] text-[var(--text-quaternary)]">
            {t('settings.mcp_no_clients')}
          </div>
        )}
      </section>

      <section className="rounded-[var(--r-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--success)]" />
          <div>
            <h3 className="text-[12.5px] font-medium text-[var(--text-primary)]">{t('settings.mcp_privacy')}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">{t('settings.mcp_privacy_desc')}</p>
          </div>
        </div>
      </section>
    </div>
  )
}

function clientSnippets(info: McpSettingsInfo): Array<{ id: string; name: string; value: string }> {
  const scopes = [
    'notes:read',
    ...(info.preferences.writeEnabled ? ['notes:write'] : []),
    ...(info.preferences.trashEnabled ? ['notes:trash'] : []),
  ]
  const scopeText = scopes.join(' ')
  const endpoint = info.endpoint
  const claudeJson = JSON.stringify({
    type: 'http',
    url: endpoint,
    oauth: { scopes: scopeText },
  })
  return [
    {
      id: 'codex',
      name: 'Codex',
      value: `codex mcp add inkstone --url "${endpoint}" --oauth-resource "${endpoint}"`,
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      value: `claude mcp add-json inkstone '${claudeJson}' --scope user\n/mcp`,
    },
    {
      id: 'hermes',
      name: 'Hermes Agent',
      value: `mcp_servers:\n  inkstone:\n    url: "${endpoint}"\n    auth: oauth\n    oauth:\n      scope: "${scopeText}"\n\nhermes mcp login inkstone`,
    },
    {
      id: 'openclaw',
      name: 'OpenClaw',
      value: `openclaw mcp add inkstone --url "${endpoint}" --transport streamable-http --auth oauth --oauth-scope "${scopeText}"\nopenclaw mcp login inkstone`,
    },
  ]
}

function scopeSummary(scopes: string[]): string {
  return scopes.map((scope) => {
    if (scope === 'notes:read') return t('settings.mcp_scope_read')
    if (scope === 'notes:write') return t('settings.mcp_scope_write')
    if (scope === 'notes:trash') return t('settings.mcp_scope_trash')
    return scope
  }).join(' · ')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

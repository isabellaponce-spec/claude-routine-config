// Weekly Product-Hiring summary → posts this week's scheduled interviews to
// Slack #product_hiring. Runs Mondays. All data via curl-able Lever Data API
// (no calendar / connectors). Env: LEVER_API_KEY, SLACK_WEBHOOK_URL, DRY_RUN.
const TOKEN = process.env.LEVER_API_KEY
const WEBHOOK = process.env.SLACK_WEBHOOK_URL
const DRY = process.env.DRY_RUN === '1'
if (!TOKEN) throw new Error('LEVER_API_KEY missing')

const TZ = 'America/Bogota'
const BASE = 'https://api.lever.co/v1'
const PRIORITIES = process.env.PRIORITIES || 'Head of Product · PO' // weekly priority roles

// interview stages we care about (matched by name from /stages)
const INTERVIEW_STAGE_NAMES = [
  'Recruiter Video Screen',
  'Skills Assessment',
  'AI Challenge',
  'Hiring Manager Interview',
  'Team Interview',
  'Bar Raiser Interview (Mandatory)',
  'Background Check',
  'Offer',
]
// friendlier labels for the message
const STAGE_LABEL = {
  'Recruiter Video Screen': 'HR Screening',
  'Skills Assessment': 'Problem Solving',
  'AI Challenge': 'AI Challenge',
  'Hiring Manager Interview': 'Product Sense',
  'Team Interview': 'Team Interview',
  'Bar Raiser Interview (Mandatory)': 'Bar Raiser',
  'Background Check': 'Background Check',
  Offer: 'Offer',
}

async function api(path, params = {}) {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x))
    else if (v != null) url.searchParams.set(k, v)
  }
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
  if (!r.ok) throw new Error(`${r.status} ${path}: ${(await r.text()).slice(0, 150)}`)
  return r.json()
}
async function pageAll(path, params = {}) {
  const out = []
  let offset
  do {
    const res = await api(path, { ...params, limit: 100, offset })
    out.push(...(res.data || []))
    offset = res.hasNext ? res.next : null
  } while (offset)
  return out
}

// --- this week (Mon 00:00 → Sun 23:59:59 in Bogota) --------------------
function weekRange(now = new Date()) {
  // day index in TZ
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now)
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts]
  // ms offset of Bogota (-5, no DST)
  const OFFSET = -5 * 3600000
  const local = new Date(now.getTime() + OFFSET)
  const y = local.getUTCFullYear(), mo = local.getUTCMonth(), d = local.getUTCDate()
  const midnightLocalUTC = Date.UTC(y, mo, d) - OFFSET // today 00:00 Bogota in real epoch
  const daysSinceMon = (dow + 6) % 7
  const start = midnightLocalUTC - daysSinceMon * 86400000
  const end = start + 7 * 86400000 - 1
  return { start, end }
}
const fmtDay = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms))
const fmtTime = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))

async function main() {
  const { start, end } = weekRange()

  const stages = await pageAll('/stages')
  const stageName = Object.fromEntries(stages.map((s) => [s.id, s.text]))
  const interviewStageIds = stages.filter((s) => INTERVIEW_STAGE_NAMES.includes(s.text)).map((s) => s.id)

  const postings = await pageAll('/postings', { limit: 100 })
  const postingText = Object.fromEntries(postings.map((p) => [p.id, p.text]))
  const productPostingIds = new Set(
    postings.filter((p) => {
      const d = (p.categories?.department || '').toLowerCase()
      const t = (p.categories?.team || '').toLowerCase()
      return d.includes('product') || t.includes('product')
    }).map((p) => p.id)
  )

  // active candidates sitting in an interview stage
  const cands = []
  const seen = new Set()
  for (const sid of interviewStageIds) {
    const batch = await pageAll('/opportunities', { stage_id: sid, expand: ['applications'], archived: false })
    for (const o of batch) {
      if (seen.has(o.id)) continue
      seen.add(o.id)
      const app = (o.applications || []).find((a) => productPostingIds.has(a.posting))
      if (!app) continue // product-hiring only
      cands.push({ id: o.id, name: o.name, role: postingText[app.posting] || '' })
    }
  }

  // scheduled interviews this week from each candidate's panels
  const events = []
  for (const c of cands) {
    let panels
    try {
      panels = (await api(`/opportunities/${c.id}/panels`)).data || []
    } catch {
      continue
    }
    for (const p of panels) {
      for (const iv of p.interviews || []) {
        if (iv.date == null || iv.date < start || iv.date > end) continue
        events.push({
          date: iv.date,
          candidate: c.name,
          role: c.role,
          stage: STAGE_LABEL[stageName[p.stage]] || stageName[p.stage] || iv.subject?.split(' - ')[0] || 'Interview',
          interviewers: (iv.interviewers || []).map((x) => x.name).filter(Boolean),
        })
      }
    }
  }
  events.sort((a, b) => a.date - b.date)

  // --- build Slack message ---------------------------------------------
  const weekLabel = new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(start)) // "Jul 27"
  const lines = [`:calendar: *Product Hiring — week of ${weekLabel}*`, '', `*Priorities:* ${PRIORITIES}`, '']

  if (events.length === 0) {
    lines.push('_No interviews scheduled this week yet._')
  } else {
    lines.push(`*Interviews this week (${events.length})*`)
    let curDay = ''
    for (const e of events) {
      const dk = dayKey(e.date)
      if (dk !== curDay) {
        curDay = dk
        lines.push('', `*${fmtDay(e.date)}*`)
      }
      const who = e.interviewers.length ? e.interviewers.join(', ') : '—'
      const role = e.role ? ` _(${e.role})_` : ''
      lines.push(`• ${fmtTime(e.date)} — *${e.candidate}*${role} · ${e.stage} · :bust_in_silhouette: ${who}`)
    }
  }
  const text = lines.join('\n')

  if (DRY || !WEBHOOK) {
    console.log('--- DRY RUN (not posted) ---\n')
    console.log(text)
    console.log(`\n--- ${events.length} interviews · ${cands.length} candidates scanned ---`)
    return
  }
  const r = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  console.log('posted:', r.status, await r.text())
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})

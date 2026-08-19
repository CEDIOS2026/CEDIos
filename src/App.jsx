import React, { useState, useEffect, useCallback } from 'react';
import {
  Target, BarChart3, ClipboardList, Settings, LogOut, Home,
  Lock, ChevronRight, ChevronDown, Plus, Trash2, User as UserIcon, Users2,
  Landmark, Boxes, AlertTriangle, MessageSquare, Download, Printer, FileText
} from 'lucide-react';
import { supabase } from './supabaseClient.js';

// ---------------------------------------------------------------------------
// CONSTANTES
// ---------------------------------------------------------------------------
const PERSPECTIVAS = ['Financiera', 'Clientes', 'Procesos', 'Aprendizaje'];
const PERSPECTIVA_LABEL = {
  Financiera: 'Financiera',
  Clientes: 'Clientes',
  Procesos: 'Procesos Internos',
  Aprendizaje: 'Aprendizaje y Crecimiento',
};
const ROLE_LABEL = { admin: 'Administrador', lider: 'Líder', colaborador: 'Colaborador' };
const PERMISOS_DEFAULT = { editarKPIs: false, editarOKRs: false, gestionarActividades: false, verBSC: false };
const PERMISOS_LABEL = {
  editarKPIs: 'Editar KPI de su área',
  editarOKRs: 'Editar OKR de su área',
  gestionarActividades: 'Gestionar actividades de su área',
  verBSC: 'Ver Balanced Scorecard',
};
const DEFAULT_COMPANY_NAME = 'Cedi';
const APP_VERSION = 'v7';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function hasPerm(user, key) {
  return user.role === 'admin' || user.role === 'lider' || !!(user.permisos && user.permisos[key]);
}

function kpiStatus(k) {
  const ratio = k.mejorMayor ? k.actual / (k.meta || 1) : (k.meta === 0 ? (k.actual === 0 ? 1 : 0) : k.meta / (k.actual || 0.0001));
  if (ratio >= 1) return 'on';
  if (ratio >= 0.9) return 'warn';
  return 'off';
}
const STATUS_COLOR = { on: 'var(--green)', warn: 'var(--amber)', off: 'var(--red)' };
const STATUS_LABEL = { on: 'En meta', warn: 'En riesgo', off: 'Fuera de meta' };

function krProgress(kr) {
  if (kr.meta === 0) return kr.actual === 0 ? 100 : 0;
  const raw = kr.mejorMayor ? (kr.actual / kr.meta) * 100 : (kr.meta / (kr.actual || 0.0001)) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function antiguedad(fechaIngreso) {
  if (!fechaIngreso) return null;
  const inicio = new Date(fechaIngreso + 'T00:00:00');
  const hoy = new Date();
  let years = hoy.getFullYear() - inicio.getFullYear();
  let months = hoy.getMonth() - inicio.getMonth();
  if (hoy.getDate() < inicio.getDate()) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return null;
  if (years === 0) return `${months} mes${months === 1 ? '' : 'es'}`;
  return `${years} año${years === 1 ? '' : 's'}${months > 0 ? ` y ${months} mes${months === 1 ? '' : 'es'}` : ''}`;
}

function diasEntreFechas(inicio, fin) {
  if (!inicio || !fin) return 0;
  const a = new Date(inicio + 'T00:00:00');
  const b = new Date(fin + 'T00:00:00');
  const diff = Math.round((b - a) / 86400000) + 1;
  return diff > 0 ? diff : 0;
}

function downloadCSV(filename, rows) {
  const csv = rows.map(row => row.map(cell => {
    const s = String(cell ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// MAPEO supabase (snake_case) -> objetos que usa la interfaz (camelCase)
// ---------------------------------------------------------------------------
function mapTeam(t) { return { id: t.id, bay: t.bay, name: t.name }; }
function mapEquipo(e) { return { id: e.id, teamId: e.team_id, name: e.name }; }
function mapProfile(p) {
  return {
    id: p.id, username: p.username, name: p.name, role: p.role, teamId: p.team_id, equipoId: p.equipo_id,
    puesto: p.puesto, jefe: p.jefe, funciones: p.funciones || [],
    permisos: { ...PERMISOS_DEFAULT, ...(p.permisos || {}) },
    avatarUrl: p.avatar_url || null, dpuPdfPath: p.dpu_pdf_path || null,
    fechaIngreso: p.fecha_ingreso || null, diasVacacionesDisponibles: Number(p.dias_vacaciones_disponibles || 0),
  };
}
function mapVacacion(v) {
  return {
    id: v.id, personaId: v.persona_id, fechaInicio: v.fecha_inicio, fechaFin: v.fecha_fin,
    dias: Number(v.dias), estado: v.estado, comentario: v.comentario || '', createdAt: v.created_at,
  };
}
function mapKpi(k) {
  return {
    id: k.id, teamId: k.team_id, name: k.name, meta: Number(k.meta), actual: Number(k.actual),
    unidad: k.unidad || '', perspectiva: k.perspectiva, mejorMayor: k.mejor_mayor,
    historial: (k.kpi_historial || []).slice().sort((a, b) => a.fecha < b.fecha ? -1 : 1)
      .map(h => ({ fecha: h.fecha, valor: Number(h.valor) })),
  };
}
function mapOkr(o) {
  return {
    id: o.id, teamId: o.team_id, objetivo: o.objetivo,
    krs: (o.okr_krs || []).map(k => ({ id: k.id, kr: k.kr, meta: Number(k.meta), actual: Number(k.actual), unidad: k.unidad || '', mejorMayor: k.mejor_mayor })),
  };
}
function mapActivity(a, usersById) {
  const asignado = usersById[a.asignado_a];
  return {
    id: a.id, teamId: a.team_id, titulo: a.titulo, estado: a.estado,
    asignadoAId: a.asignado_a, asignadoA: asignado ? asignado.username : '—', fecha: a.fecha,
    comentarios: (a.activity_comentarios || []).map(c => ({
      id: c.id, autor: (usersById[c.autor_id] || {}).username || '—', texto: c.texto, fecha: c.fecha,
    })).sort((x, y) => x.fecha < y.fecha ? -1 : 1),
  };
}

// ---------------------------------------------------------------------------
// PIEZAS DE INTERFAZ
// ---------------------------------------------------------------------------
function DockLight({ status }) {
  return <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: STATUS_COLOR[status], flexShrink: 0 }} />;
}

function ProgressBar({ pct, color }) {
  return (
    <div style={{ background: 'var(--border)', height: 6, borderRadius: 3, overflow: 'hidden', width: '100%' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color || 'var(--amber)', transition: 'width .4s ease' }} />
    </div>
  );
}

function Sparkline({ points, color, width = 120, height = 34 }) {
  if (!points || points.length < 2) return <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sin historial suficiente.</div>;
  const values = points.map(p => p.valor);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const coords = values.map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline points={coords.join(' ')} fill="none" stroke={color || 'var(--blue)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map((c, i) => { const [x, y] = c.split(','); return <circle key={i} cx={x} cy={y} r="2.2" fill={color || 'var(--blue)'} />; })}
    </svg>
  );
}

function AlertsBanner({ kpis }) {
  const alerts = kpis.filter(k => kpiStatus(k) !== 'on');
  if (alerts.length === 0) return null;
  return (
    <div style={{ background: '#FDF3EE', border: '1px solid #F0D9CC', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--red)' }}>
        <AlertTriangle size={16} /> {alerts.length} KPI fuera de meta o en riesgo
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {alerts.map(k => {
          const s = kpiStatus(k);
          return (
            <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <DockLight status={s} />
              <span style={{ flex: 1 }}>{k.name}</span>
              <span style={{ fontWeight: 600, color: STATUS_COLOR[s] }}>{k.actual}{k.unidad} / meta {k.meta}{k.unidad}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Panel({ children, style }) {
  return <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 18, padding: 22, boxShadow: '0 1px 2px rgba(16,24,32,0.04)', ...style }}>{children}</div>;
}

function Eyebrow({ children }) {
  return <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, letterSpacing: '0.02em', color: 'var(--text-dim)', fontWeight: 600, marginBottom: 10 }}>{children}</div>;
}

function Btn({ children, onClick, variant = 'primary', style, type = 'button', disabled }) {
  const base = { fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 14.5, padding: '10px 18px', borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer', border: '1px solid transparent', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: disabled ? 0.5 : 1 };
  const variants = {
    primary: { background: 'var(--dark)', color: '#fff' },
    ghost: { background: '#fff', color: 'var(--text)', border: '1px solid var(--border)' },
    danger: { background: 'transparent', color: 'var(--red)', border: '1px solid var(--red)' },
  };
  return <button type={type} disabled={disabled} onClick={onClick} style={{ ...base, ...variants[variant], ...style }}>{children}</button>;
}

function Input(props) {
  return <input {...props} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', padding: '10px 12px', fontSize: 14, fontFamily: "'Plus Jakarta Sans', sans-serif", width: '100%', boxSizing: 'border-box', ...(props.style || {}) }} />;
}

function Select(props) {
  return <select {...props} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', padding: '10px 12px', fontSize: 14, fontFamily: "'Plus Jakarta Sans', sans-serif", width: '100%', boxSizing: 'border-box', ...(props.style || {}) }} />;
}

function EditableNumber({ value, onCommit, style }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => { setLocal(String(value)); }, [value]);
  return <Input type="number" step="any" value={local} onChange={e => setLocal(e.target.value)} onBlur={() => onCommit(local)} style={style} />;
}

// ---------------------------------------------------------------------------
// FOTO DE PERFIL Y DPU EN PDF
// ---------------------------------------------------------------------------
function Avatar({ url, name, size = 44 }) {
  if (url) {
    return <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: 'var(--panel-alt)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700, color: 'var(--text-dim)',
      fontSize: size * 0.4,
    }}>
      {(name || '?').charAt(0).toUpperCase()}
    </div>
  );
}

function AvatarUploader({ persona, onUploadAvatar }) {
  const [busy, setBusy] = useState(false);
  const inputId = `avatar-${persona.id}`;

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    await onUploadAvatar(persona.id, file);
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Avatar url={persona.avatarUrl} name={persona.name} size={48} />
      <label htmlFor={inputId} style={{ cursor: 'pointer' }}>
        <span style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 600 }}>{busy ? 'Subiendo…' : 'Cambiar foto'}</span>
        <input id={inputId} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} disabled={busy} />
      </label>
    </div>
  );
}

function DpuPdfUploader({ persona, onUploadDpuPdf, onViewDpuPdf, canUpload = true }) {
  const [busy, setBusy] = useState(false);
  const inputId = `dpu-pdf-${persona.id}`;

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    await onUploadDpuPdf(persona.id, file);
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      {persona.dpuPdfPath ? (
        <Btn variant="ghost" onClick={() => onViewDpuPdf(persona.dpuPdfPath)}><FileText size={14} /> Ver DPU en PDF</Btn>
      ) : !canUpload && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Tu administrador todavía no ha subido tu DPU en PDF.</div>
      )}
      {canUpload && (
        <label htmlFor={inputId} style={{ cursor: 'pointer' }}>
          <span style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 600 }}>
            {busy ? 'Subiendo…' : persona.dpuPdfPath ? 'Reemplazar PDF' : 'Subir DPU en PDF'}
          </span>
          <input id={inputId} type="file" accept="application/pdf" onChange={handleFile} style={{ display: 'none' }} disabled={busy} />
        </label>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MI PERFIL — fecha de ingreso, vacaciones disponibles, y solicitud de vacaciones
// ---------------------------------------------------------------------------
const VAC_ESTADO_LABEL = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };
const VAC_ESTADO_COLOR = { pendiente: 'var(--amber)', aprobada: 'var(--green)', rechazada: 'var(--red)' };

function MiPerfilPanel({ user, vacaciones, onRequestVacation, onCancelVacation }) {
  const [open, setOpen] = useState(false);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const dias = diasEntreFechas(fechaInicio, fechaFin);
  const misSolicitudes = vacaciones
    .filter(v => v.personaId === user.id)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const diasUsadosOPendientes = misSolicitudes
    .filter(v => v.estado !== 'rechazada')
    .reduce((s, v) => s + v.dias, 0);
  const disponiblesRestantes = Math.max(0, (user.diasVacacionesDisponibles || 0) - diasUsadosOPendientes);

  function solicitar() {
    if (!fechaInicio || !fechaFin || dias <= 0) return;
    onRequestVacation(fechaInicio, fechaFin, dias);
    setFechaInicio(''); setFechaFin('');
  }

  return (
    <Panel>
      <button onClick={() => setOpen(o => !o)} style={{
        all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%',
      }}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ fontSize: 15, fontWeight: 700 }}>Mi Perfil</span>
      </button>
      {open && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Fecha de ingreso</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {user.fechaIngreso ? new Date(user.fechaIngreso + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Sin registrar'}
              </div>
              {user.fechaIngreso && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{antiguedad(user.fechaIngreso)} de antigüedad</div>}
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Días de vacaciones disponibles</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{disponiblesRestantes} de {user.diasVacacionesDisponibles || 0}</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Solicitar vacaciones</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Desde</div>
                <Input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} style={{ width: 160 }} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Hasta</div>
                <Input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} style={{ width: 160 }} />
              </div>
              {fechaInicio && fechaFin && <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{dias} día{dias === 1 ? '' : 's'}</div>}
              <Btn onClick={solicitar} disabled={!fechaInicio || !fechaFin || dias <= 0}>Solicitar</Btn>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Tus solicitudes</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {misSolicitudes.map(v => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ flex: 1 }}>{v.fechaInicio} → {v.fechaFin} ({v.dias} día{v.dias === 1 ? '' : 's'})</span>
                  <span style={{ color: VAC_ESTADO_COLOR[v.estado], fontWeight: 600 }}>{VAC_ESTADO_LABEL[v.estado]}</span>
                  {v.estado === 'pendiente' && (
                    <button onClick={() => onCancelVacation(v.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {misSolicitudes.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Todavía no has solicitado vacaciones.</div>}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
function LoginScreen({ onLogin, companyName }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email.trim() || !password) { setError('Ingresa tu correo y tu contraseña.'); return; }
    setLoading(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (err) { setError('Correo o contraseña incorrectos.'); return; }
    onLogin();
  }
  function handleKeyDown(e) { if (e.key === 'Enter') submit(); }

  return (
    <div style={{ minHeight: '100%', position: 'relative', background: 'radial-gradient(circle at 70% 15%, #ffffff 0%, #eceef1 55%, #e2e4e8 100%)', padding: 32 }}>
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 24, color: 'var(--text)', letterSpacing: '-0.02em' }}>
        {companyName.toLowerCase()}<span style={{ color: 'var(--blue)' }}>.</span>
      </div>
      <div style={{ minHeight: 460, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 22, padding: 32, boxShadow: '0 8px 30px rgba(20,24,30,0.08)' }}>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 26, color: 'var(--text)', marginBottom: 6 }}>Bienvenid@ de vuelta</div>
            <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 22, lineHeight: 1.5 }}>Ingresa tus credenciales para acceder al {companyName} OS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>Correo electrónico</div>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={handleKeyDown} placeholder="tu@empresa.com" autoFocus />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>Contraseña</div>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKeyDown} placeholder="••••••••" />
              </div>
              {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
              <Btn onClick={submit} disabled={loading} style={{ justifyContent: 'center', marginTop: 6, width: '100%' }}>
                <Lock size={15} /> {loading ? 'Entrando…' : 'Iniciar sesión'}
              </Btn>
            </div>
          </div>
          <div style={{ marginTop: 18, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7, textAlign: 'center' }}>
            Tu cuenta la crea el administrador desde el panel de Supabase.
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DPU VIEW
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// INICIO (Home) — el punto de partida del día, no un dashboard más
// ---------------------------------------------------------------------------
function HomeView({ user, teams, equipos, kpis, okrsEquipo, activities, vacaciones, users, onGo }) {
  const hour = new Date().getHours();
  const saludo = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const primerNombre = (user.name || '').split(' ')[0];
  const hoyStr = new Date().toISOString().slice(0, 10);

  const isAdmin = user.role === 'admin';
  const isLider = user.role === 'lider';

  const misActividades = activities.filter(a => a.asignadoAId === user.id && a.estado !== 'completada');
  const vencenHoy = misActividades.filter(a => a.fecha === hoyStr);

  const myKpis = kpis.filter(k => (user.teamId ? k.teamId === user.teamId : k.teamId === null));
  const onCount = myKpis.filter(k => kpiStatus(k) === 'on').length;
  const atRisk = myKpis.filter(k => kpiStatus(k) !== 'on');

  const myOkrs = user.teamId ? okrsEquipo.filter(o => o.teamId === user.teamId) : okrsEquipo;
  const allKrs = myOkrs.flatMap(o => o.krs);
  const avgProgress = allKrs.length ? Math.round(allKrs.reduce((s, kr) => s + krProgress(kr), 0) / allKrs.length) : null;

  const team = teams.find(t => t.id === user.teamId);

  const vacacionesPendientes = isAdmin
    ? vacaciones.filter(v => v.estado === 'pendiente')
    : isLider
      ? vacaciones.filter(v => v.estado === 'pendiente' && v.personaId !== user.id && (users.find(u => u.id === v.personaId) || {}).teamId === user.teamId)
      : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{saludo}, {primerNombre}</div>
        <div style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 2 }}>{user.puesto}{team ? ` · ${team.name}` : ''}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <Panel>
          <Eyebrow>Hoy</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => onGo('trabajo')} style={{ all: 'unset', cursor: 'pointer', fontSize: 15 }}>
              <strong>{misActividades.length}</strong> actividad{misActividades.length === 1 ? '' : 'es'} pendiente{misActividades.length === 1 ? '' : 's'}
            </button>
            {vencenHoy.length > 0 && (
              <div style={{ fontSize: 13, color: 'var(--red)' }}>{vencenHoy.length} vence{vencenHoy.length === 1 ? '' : 'n'} hoy</div>
            )}
            {misActividades.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Sin pendientes por ahora.</div>}
          </div>
        </Panel>

        <Panel>
          <Eyebrow>Tu desempeño</Eyebrow>
          <button onClick={() => onGo('desempeno')} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
            <div style={{ fontSize: 15 }}><strong>{onCount}</strong> de <strong>{myKpis.length}</strong> KPI en meta</div>
            {atRisk.length > 0 && <div style={{ fontSize: 13, color: 'var(--amber)', marginTop: 4 }}>{atRisk.length} requiere{atRisk.length === 1 ? '' : 'n'} atención</div>}
          </button>
        </Panel>

        <Panel>
          <Eyebrow>Tus objetivos</Eyebrow>
          <button onClick={() => onGo('objetivos')} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
            {avgProgress !== null ? (
              <>
                <div style={{ fontSize: 15, marginBottom: 6 }}>OKR del periodo: <strong>{avgProgress}%</strong></div>
                <ProgressBar pct={avgProgress} color={avgProgress >= 80 ? 'var(--green)' : avgProgress >= 50 ? 'var(--amber)' : 'var(--red)'} />
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
                  {avgProgress >= 80 ? 'En trayectoria' : avgProgress >= 50 ? 'Requiere seguimiento' : 'Atrás de lo esperado'}
                </div>
              </>
            ) : <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Sin OKR definidos todavía.</div>}
          </button>
        </Panel>
      </div>

      {(atRisk.length > 0 || vacacionesPendientes.length > 0) && (
        <Panel>
          <Eyebrow>Atención</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {atRisk.map(k => {
              const s = kpiStatus(k);
              return (
                <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <AlertTriangle size={15} color={STATUS_COLOR[s]} />
                  <span style={{ flex: 1 }}>{k.name}</span>
                  <span style={{ fontWeight: 600, color: STATUS_COLOR[s] }}>{k.actual}{k.unidad} vs meta {k.meta}{k.unidad}</span>
                </div>
              );
            })}
            {vacacionesPendientes.length > 0 && (
              <button onClick={() => onGo(isAdmin ? 'admin' : 'equipo')} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <AlertTriangle size={15} color="var(--amber)" />
                <span>{vacacionesPendientes.length} solicitud{vacacionesPendientes.length === 1 ? '' : 'es'} de vacaciones esperando tu aprobación</span>
              </button>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

function DPUView({ user, teams, equipos, kpis, okrsEquipo, vacaciones, onUploadAvatar, onViewDpuPdf, onRequestVacation, onCancelVacation }) {
  const team = teams.find(t => t.id === user.teamId);
  const equipo = equipos.find(e => e.id === user.equipoId);
  const myKpis = kpis.filter(k => (user.teamId ? k.teamId === user.teamId : k.teamId === null));
  const myOkrs = user.teamId ? okrsEquipo.filter(o => o.teamId === user.teamId) : okrsEquipo;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <AlertsBanner kpis={myKpis} />
      <Panel>
        <Eyebrow>Descripción de Puesto y Unidad · DPU</Eyebrow>
        <div className="no-print" style={{ marginBottom: 16 }}>
          <AvatarUploader persona={user} onUploadAvatar={onUploadAvatar} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 14 }}>
          <div><div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Nombre</div><div style={{ fontSize: 18, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600 }}>{user.name}</div></div>
          <div><div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Puesto</div><div style={{ fontSize: 18, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600 }}>{user.puesto}</div></div>
          <div><div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Área</div><div style={{ fontSize: 18, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600 }}>{team ? `${team.bay} · ${team.name}` : 'Dirección General'}</div></div>
          {equipo && <div><div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Equipo</div><div style={{ fontSize: 18, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600 }}>{equipo.name}</div></div>}
          <div><div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Jefe directo</div><div style={{ fontSize: 18, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600 }}>{user.jefe}</div></div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Funciones clave</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {user.funciones.map((f, i) => <li key={i} style={{ fontSize: 14 }}>{f}</li>)}
        </ul>
        <div className="no-print" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <DpuPdfUploader persona={user} onViewDpuPdf={onViewDpuPdf} canUpload={false} />
        </div>
      </Panel>

      <Panel>
        <Eyebrow>KPI que te aplican</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {myKpis.map(k => {
            const s = kpiStatus(k);
            return (
              <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <DockLight status={s} />
                <div style={{ flex: 1, fontSize: 14 }}>{k.name}</div>
                <Sparkline points={k.historial} color={STATUS_COLOR[s]} width={90} height={28} />
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 14, color: STATUS_COLOR[s], width: 170, textAlign: 'right' }}>
                  {k.actual}{k.unidad} <span style={{ color: 'var(--text-dim)' }}>/ meta {k.meta}{k.unidad}</span>
                </div>
              </div>
            );
          })}
          {myKpis.length === 0 && <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>Sin KPI asignados todavía.</div>}
        </div>
      </Panel>

      <Panel>
        <Eyebrow>OKR de tu área en el periodo</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {myOkrs.map(o => (
            <div key={o.id}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{o.objetivo}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {o.krs.map((kr, i) => {
                  const pct = krProgress(kr);
                  const color = pct >= 100 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)';
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-dim)' }}>{kr.kr}</span>
                        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{kr.actual}{kr.unidad} / {kr.meta}{kr.unidad}</span>
                      </div>
                      <ProgressBar pct={pct} color={color} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {myOkrs.length === 0 && <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>Sin OKR definidos todavía.</div>}
        </div>
      </Panel>

      <MiPerfilPanel user={user} vacaciones={vacaciones} onRequestVacation={onRequestVacation} onCancelVacation={onCancelVacation} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ACTIVIDADES VIEW
// ---------------------------------------------------------------------------
function ActividadesView({ user, teams, users, activities, onUpdateStatus, onAddActivity, onRemoveActivity, onAddComment }) {
  const isAdmin = user.role === 'admin';
  const canManage = hasPerm(user, 'gestionarActividades');
  const [teamFilter, setTeamFilter] = useState('all');
  const [newTitle, setNewTitle] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newDate, setNewDate] = useState('');

  const visible = isAdmin
    ? activities.filter(a => teamFilter === 'all' ? true : a.teamId === teamFilter)
    : canManage
      ? activities.filter(a => a.teamId === user.teamId)
      : activities.filter(a => a.asignadoAId === user.id);

  const assignableUsers = isAdmin ? users : users.filter(u => u.teamId === user.teamId);

  function addActivity() {
    if (!newTitle.trim() || !newAssignee) return;
    onAddActivity({ titulo: newTitle.trim(), asignadoAUsername: newAssignee, fecha: newDate || null });
    setNewTitle(''); setNewAssignee(''); setNewDate('');
  }
  function addOwnActivity() {
    if (!newTitle.trim()) return;
    onAddActivity({ titulo: newTitle.trim(), asignadoAUsername: user.username, fecha: newDate || null });
    setNewTitle(''); setNewDate('');
  }

  const STATUS_OPTS = ['pendiente', 'en_progreso', 'completada'];
  const STATUS_TEXT = { pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada' };
  const STATUS_COL = { pendiente: 'var(--red)', en_progreso: 'var(--amber)', completada: 'var(--green)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel>
        <Eyebrow>{isAdmin ? 'Actividades de la organización' : canManage ? 'Actividades de tu área' : 'Mis actividades'}</Eyebrow>
        {isAdmin && (
          <div style={{ marginBottom: 14, maxWidth: 240 }}>
            <Select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
              <option value="all">Todas las áreas</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.bay} · {t.name}</option>)}
            </Select>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {visible.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 14 }}>Sin actividades registradas todavía.</div>}
          {visible.map(a => (
            <ActivityRow
              key={a.id} activity={a} team={teams.find(t => t.id === a.teamId)}
              isAdmin={isAdmin} canManage={canManage} isMine={a.asignadoAId === user.id}
              statusOpts={STATUS_OPTS} statusText={STATUS_TEXT} statusCol={STATUS_COL}
              onStatusChange={estado => onUpdateStatus(a.id, estado)}
              onRemove={() => onRemoveActivity(a.id)}
              onComment={texto => onAddComment(a.id, texto)}
            />
          ))}
        </div>
      </Panel>

      {(isAdmin || canManage) && (
        <Panel>
          <Eyebrow>Nueva actividad</Eyebrow>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}><Input placeholder="Título de la actividad" value={newTitle} onChange={e => setNewTitle(e.target.value)} /></div>
            <div style={{ flex: '1 1 160px' }}>
              <Select value={newAssignee} onChange={e => setNewAssignee(e.target.value)}>
                <option value="">Asignar a…</option>
                {assignableUsers.map(m => <option key={m.id} value={m.username}>{m.name} ({m.username})</option>)}
              </Select>
            </div>
            <div style={{ flex: '0 1 160px' }}><Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} /></div>
            <Btn onClick={addActivity}><Plus size={15} /> Agregar</Btn>
          </div>
        </Panel>
      )}
      {!isAdmin && !canManage && (
        <Panel>
          <Eyebrow>Agregar actividad propia</Eyebrow>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}><Input placeholder="Título de la actividad" value={newTitle} onChange={e => setNewTitle(e.target.value)} /></div>
            <div style={{ flex: '0 1 160px' }}><Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} /></div>
            <Btn onClick={addOwnActivity}><Plus size={15} /> Agregar</Btn>
          </div>
        </Panel>
      )}
    </div>
  );
}

function ActivityRow({ activity: a, team, isAdmin, canManage, isMine, statusOpts, statusText, statusCol, onStatusChange, onRemove, onComment }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const canEditThis = isAdmin || canManage || isMine;
  const comentarios = a.comentarios || [];

  function send() { if (!draft.trim()) return; onComment(draft); setDraft(''); }

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusCol[a.estado], flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14 }}>{a.titulo}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{team ? `${team.bay} ${team.name}` : ''} · {a.asignadoA} · {a.fecha || '—'}</div>
        </div>
        {canEditThis ? (
          <Select value={a.estado} onChange={e => onStatusChange(e.target.value)} style={{ width: 150 }}>
            {statusOpts.map(s => <option key={s} value={s}>{statusText[s]}</option>)}
          </Select>
        ) : <span style={{ fontSize: 12, color: statusCol[a.estado] }}>{statusText[a.estado]}</span>}
        <button className="no-print" onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <MessageSquare size={14} /> {comentarios.length}
        </button>
        {(isAdmin || canManage) && (
          <button className="no-print" onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><Trash2 size={15} /></button>
        )}
      </div>
      {open && (
        <div className="no-print" style={{ marginTop: 10, marginLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {comentarios.map(c => (
            <div key={c.id} style={{ fontSize: 13, background: 'var(--panel-alt)', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>{c.autor} <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>· {c.fecha}</span></div>
              <div>{c.texto}</div>
            </div>
          ))}
          {comentarios.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Sin comentarios todavía.</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <Input placeholder="Escribe un comentario…" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} />
            <Btn variant="ghost" onClick={send}>Comentar</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPIS VIEW
// ---------------------------------------------------------------------------
function KPIsView({ user, teams, kpis, onUpdateActual }) {
  const isAdmin = user.role === 'admin';
  const canEdit = (k) => isAdmin || (hasPerm(user, 'editarKPIs') && k.teamId === user.teamId);

  const relevantTeams = isAdmin ? teams : teams.filter(t => t.id === user.teamId);
  const grouped = relevantTeams.map(t => ({ team: t, kpis: kpis.filter(k => k.teamId === t.id) }));
  const companyKpis = isAdmin ? kpis.filter(k => k.teamId === null) : [];
  const visibleKpis = [...grouped.flatMap(g => g.kpis), ...companyKpis];

  function exportCSV() {
    const header = ['Área', 'KPI', 'Perspectiva', 'Meta', 'Actual', 'Estado'];
    const rows = visibleKpis.map(k => {
      const team = teams.find(t => t.id === k.teamId);
      return [team ? team.name : 'Corporativo', k.name, PERSPECTIVA_LABEL[k.perspectiva], `${k.meta}${k.unidad}`, `${k.actual}${k.unidad}`, STATUS_LABEL[kpiStatus(k)]];
    });
    downloadCSV('kpis_cedi.csv', [header, ...rows]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <AlertsBanner kpis={visibleKpis} />
      <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={exportCSV}><Download size={14} /> Exportar CSV</Btn>
        <Btn variant="ghost" onClick={() => window.print()}><Printer size={14} /> Imprimir / PDF</Btn>
      </div>
      {grouped.filter(g => g.kpis.length).map(g => (
        <Panel key={g.team.id}>
          <Eyebrow>{`Área ${g.team.bay} · ${g.team.name}`}</Eyebrow>
          <KpiTable rows={g.kpis} canEdit={canEdit} onUpdateActual={onUpdateActual} />
        </Panel>
      ))}
      {isAdmin && (
        <Panel>
          <Eyebrow>KPI corporativos</Eyebrow>
          <KpiTable rows={companyKpis} canEdit={canEdit} onUpdateActual={onUpdateActual} />
        </Panel>
      )}
    </div>
  );
}

function KpiTable({ rows, canEdit, onUpdateActual }) {
  const [expanded, setExpanded] = useState({});
  function toggle(id) { setExpanded(e => ({ ...e, [id]: !e[id] })); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map(k => {
        const s = kpiStatus(k);
        const isOpen = !!expanded[k.id];
        return (
          <div key={k.id} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <DockLight status={s} />
              <button className="no-print" onClick={() => toggle(k.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 0 }}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <div style={{ flex: 1, fontSize: 14 }}>{k.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', width: 90 }}>{PERSPECTIVA_LABEL[k.perspectiva]}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', width: 100 }}>meta {k.meta}{k.unidad}</div>
              {canEdit(k) ? (
                <EditableNumber value={k.actual} onCommit={val => onUpdateActual(k.id, val)} style={{ width: 90 }} />
              ) : <div style={{ width: 90, color: STATUS_COLOR[s] }}>{k.actual}{k.unidad}</div>}
              <span style={{ fontSize: 11, color: STATUS_COLOR[s], width: 90 }}>{STATUS_LABEL[s]}</span>
            </div>
            {isOpen && (
              <div style={{ marginTop: 10, marginLeft: 24, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <Sparkline points={k.historial} color={STATUS_COLOR[s]} width={140} height={36} />
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{(k.historial || []).map(h => `${h.fecha}: ${h.valor}${k.unidad}`).join(' · ')}</div>
              </div>
            )}
          </div>
        );
      })}
      {rows.length === 0 && <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>Sin KPI asignados todavía.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OKRS VIEW (equipo)
// ---------------------------------------------------------------------------
function OKRsView({ user, teams, okrsEquipo, onUpdateKrActual, onAddOkr }) {
  const isAdmin = user.role === 'admin';
  const canManageOkrs = hasPerm(user, 'editarOKRs');
  const canEditTeam = (teamId) => isAdmin || (canManageOkrs && teamId === user.teamId);

  const [newTeamId, setNewTeamId] = useState(isAdmin ? '' : user.teamId);
  const [newObjetivo, setNewObjetivo] = useState('');
  function addOkr() {
    const teamId = isAdmin ? newTeamId : user.teamId;
    if (!newObjetivo.trim() || !teamId) return;
    onAddOkr(teamId, newObjetivo.trim());
    setNewObjetivo('');
  }

  const relevantTeams = isAdmin ? teams : teams.filter(t => t.id === user.teamId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {relevantTeams.map(t => {
        const teamOkrs = okrsEquipo.filter(o => o.teamId === t.id);
        if (!teamOkrs.length) return null;
        return (
          <Panel key={t.id}>
            <Eyebrow>{`Área ${t.bay} · ${t.name}`}</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {teamOkrs.map(o => (
                <div key={o.id}>
                  <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{o.objetivo}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {o.krs.map((kr) => {
                      const pct = krProgress(kr);
                      const color = pct >= 100 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)';
                      return (
                        <div key={kr.id}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 4, gap: 8 }}>
                            <span style={{ color: 'var(--text-dim)' }}>{kr.kr}</span>
                            {canEditTeam(t.id) ? (
                              <EditableNumber value={kr.actual} onCommit={val => onUpdateKrActual(kr.id, val)} style={{ width: 90 }} />
                            ) : <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{kr.actual}{kr.unidad} / {kr.meta}{kr.unidad}</span>}
                          </div>
                          <ProgressBar pct={pct} color={color} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        );
      })}

      {(isAdmin || canManageOkrs) && (
        <Panel>
          <Eyebrow>Nuevo objetivo de área</Eyebrow>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {isAdmin && (
              <div style={{ flex: '1 1 180px' }}>
                <Select value={newTeamId} onChange={e => setNewTeamId(e.target.value)}>
                  <option value="">Área…</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.bay} · {t.name}</option>)}
                </Select>
              </div>
            )}
            <div style={{ flex: '2 1 220px' }}><Input placeholder="Objetivo del periodo" value={newObjetivo} onChange={e => setNewObjetivo(e.target.value)} /></div>
            <Btn onClick={addOkr}><Plus size={15} /> Agregar</Btn>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BALANCED SCORECARD VIEW
// ---------------------------------------------------------------------------
function BSCView({ kpis, teams }) {
  function exportCSV() {
    const header = ['Perspectiva', 'Área', 'KPI', 'Meta', 'Actual', 'Estado'];
    const rows = kpis.map(k => {
      const team = teams.find(t => t.id === k.teamId);
      return [PERSPECTIVA_LABEL[k.perspectiva], team ? team.name : 'Corporativo', k.name, `${k.meta}${k.unidad}`, `${k.actual}${k.unidad}`, STATUS_LABEL[kpiStatus(k)]];
    });
    downloadCSV('balanced_scorecard_cedi.csv', [header, ...rows]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <AlertsBanner kpis={kpis} />
      <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={exportCSV}><Download size={14} /> Exportar CSV</Btn>
        <Btn variant="ghost" onClick={() => window.print()}><Printer size={14} /> Imprimir / PDF</Btn>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {PERSPECTIVAS.map(p => {
          const rows = kpis.filter(k => k.perspectiva === p);
          const onCount = rows.filter(k => kpiStatus(k) === 'on').length;
          return (
            <Panel key={p}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <Eyebrow>{PERSPECTIVA_LABEL[p]}</Eyebrow>
                <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, color: 'var(--text-dim)' }}>{onCount}/{rows.length} en meta</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map(k => {
                  const s = kpiStatus(k);
                  const team = teams.find(t => t.id === k.teamId);
                  return (
                    <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <DockLight status={s} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13 }}>{k.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{team ? `${team.bay} ${team.name}` : 'Corporativo'}</div>
                      </div>
                      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, color: STATUS_COLOR[s] }}>{k.actual}{k.unidad}</div>
                    </div>
                  );
                })}
                {rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Sin KPI asignados.</div>}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ADMIN VIEW
// ---------------------------------------------------------------------------
function UserRow({ user, team, teams, equipos, onSaveProfile, onTogglePermiso, onUploadAvatar, onUploadDpuPdf, onViewDpuPdf, vacaciones, onReviewVacation }) {
  const [open, setOpen] = useState(false);
  const isAdmin = user.role === 'admin';
  const isLider = user.role === 'lider';
  const [form, setForm] = useState({
    name: user.name, puesto: user.puesto, jefe: user.jefe, role: user.role, teamId: user.teamId || '', equipoId: user.equipoId || '',
    funciones: (user.funciones || []).join('\n'), fechaIngreso: user.fechaIngreso || '', diasVacacionesDisponibles: user.diasVacacionesDisponibles || 0,
  });

  const equiposDeArea = equipos.filter(e => e.teamId === form.teamId);
  const solicitudesPendientes = vacaciones.filter(v => v.personaId === user.id && v.estado === 'pendiente');

  function save() {
    onSaveProfile(user.id, {
      name: form.name, puesto: form.puesto, jefe: form.jefe, role: form.role,
      teamId: form.teamId || null, equipoId: form.equipoId || null,
      funciones: form.funciones.split('\n').map(s => s.trim()).filter(Boolean),
      fechaIngreso: form.fechaIngreso || null, diasVacacionesDisponibles: parseFloat(form.diasVacacionesDisponibles) || 0,
    });
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
        <Avatar url={user.avatarUrl} name={user.name} size={28} />
        <span style={{ flex: 1 }}>{user.name} — {user.puesto}</span>
        {solicitudesPendientes.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 600 }}>{solicitudesPendientes.length} vacación pendiente</span>
        )}
        <span style={{ color: 'var(--text-dim)', width: 110 }}>{ROLE_LABEL[user.role]}</span>
        <span style={{ color: 'var(--text-dim)', width: 90 }}>{team ? team.name : '—'}</span>
        <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Editar
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 10, marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Usuario: {user.username}</div>
          <AvatarUploader persona={user} onUploadAvatar={onUploadAvatar} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Input placeholder="Nombre completo" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <Select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option value="colaborador">Colaborador</option>
              <option value="lider">Líder</option>
              <option value="admin">Administrador</option>
            </Select>
            <Select value={form.teamId} onChange={e => setForm({ ...form, teamId: e.target.value, equipoId: '' })}>
              <option value="">Sin área / Dirección</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.bay} · {t.name}</option>)}
            </Select>
            <Select value={form.equipoId} onChange={e => setForm({ ...form, equipoId: e.target.value })} disabled={!form.teamId}>
              <option value="">Sin equipo específico</option>
              {equiposDeArea.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
            </Select>
            <Input placeholder="Puesto" value={form.puesto} onChange={e => setForm({ ...form, puesto: e.target.value })} />
            <Input placeholder="Jefe directo" value={form.jefe} onChange={e => setForm({ ...form, jefe: e.target.value })} />
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Fecha de ingreso</div>
              <Input type="date" value={form.fechaIngreso} onChange={e => setForm({ ...form, fechaIngreso: e.target.value })} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Días de vacaciones al año</div>
              <Input type="number" min="0" value={form.diasVacacionesDisponibles} onChange={e => setForm({ ...form, diasVacacionesDisponibles: e.target.value })} />
            </div>
          </div>
          <textarea
            placeholder="Funciones clave (una por línea)" value={form.funciones} rows={3}
            onChange={e => setForm({ ...form, funciones: e.target.value })}
            style={{ width: '100%', boxSizing: 'border-box', background: '#fff', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', padding: '10px 12px', fontSize: 14, fontFamily: "'Plus Jakarta Sans', sans-serif", resize: 'vertical' }}
          />
          <Btn onClick={save} style={{ alignSelf: 'flex-start' }}>Guardar cambios</Btn>
          <DpuPdfUploader persona={user} onUploadDpuPdf={onUploadDpuPdf} onViewDpuPdf={onViewDpuPdf} />

          {vacaciones.filter(v => v.personaId === user.id).length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Solicitudes de vacaciones</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {vacaciones.filter(v => v.personaId === user.id).map(v => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ flex: 1 }}>{v.fechaInicio} → {v.fechaFin} ({v.dias} día{v.dias === 1 ? '' : 's'})</span>
                    {v.estado === 'pendiente' ? (
                      <>
                        <Btn variant="ghost" onClick={() => onReviewVacation(v.id, 'aprobada')} style={{ padding: '4px 10px', fontSize: 12 }}>Aprobar</Btn>
                        <Btn variant="danger" onClick={() => onReviewVacation(v.id, 'rechazada')} style={{ padding: '4px 10px', fontSize: 12 }}>Rechazar</Btn>
                      </>
                    ) : (
                      <span style={{ color: VAC_ESTADO_COLOR[v.estado], fontWeight: 600 }}>{VAC_ESTADO_LABEL[v.estado]}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isLider && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', background: 'var(--panel-alt)', borderRadius: 10, padding: '8px 10px' }}>
              Como Líder, esta persona ya tiene automáticamente todos los permisos de gestión sobre su área
              (editar KPI, editar OKR, gestionar actividades, ver Balanced Scorecard) — no hace falta activarlos.
            </div>
          )}
          {!isAdmin && !isLider && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Permisos adicionales</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                {Object.keys(PERMISOS_DEFAULT).map(key => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!(user.permisos && user.permisos[key])} onChange={() => onTogglePermiso(user.id, key)} />
                    {PERMISOS_LABEL[key]}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminView({ empresaName, teams, equipos, users, vacaciones, onSaveEmpresa, onAddTeam, onRemoveTeam, onAddEquipo, onRemoveEquipo, onSaveProfile, onTogglePermiso, onUploadAvatar, onUploadDpuPdf, onViewDpuPdf, onReviewVacation }) {
  const [newTeamName, setNewTeamName] = useState('');
  const [newEquipoTeamId, setNewEquipoTeamId] = useState('');
  const [newEquipoName, setNewEquipoName] = useState('');
  const [companyDraft, setCompanyDraft] = useState(empresaName);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel>
        <Eyebrow>Empresa</Eyebrow>
        <div style={{ display: 'flex', gap: 8, maxWidth: 420 }}>
          <Input value={companyDraft} onChange={e => setCompanyDraft(e.target.value)} />
          <Btn onClick={() => onSaveEmpresa(companyDraft.trim() || empresaName)}>Guardar</Btn>
        </div>
      </Panel>

      <Panel>
        <Eyebrow>Áreas</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {teams.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, padding: '4px 0' }}>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'var(--blue)' }}>{t.bay}</span>
              <span style={{ flex: 1 }}>{t.name}</span>
              <button onClick={() => onRemoveTeam(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input placeholder="Nombre de la nueva área" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} />
          <Btn onClick={() => { if (newTeamName.trim()) { onAddTeam(newTeamName.trim()); setNewTeamName(''); } }}><Plus size={15} /> Agregar área</Btn>
        </div>
      </Panel>

      <Panel>
        <Eyebrow>Equipos (subdivisiones dentro de un área)</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {equipos.map(eq => {
            const team = teams.find(t => t.id === eq.teamId);
            return (
              <div key={eq.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, padding: '4px 0' }}>
                <span style={{ color: 'var(--text-dim)', width: 100 }}>{team ? team.name : '—'}</span>
                <span style={{ flex: 1 }}>{eq.name}</span>
                <button onClick={() => onRemoveEquipo(eq.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><Trash2 size={14} /></button>
              </div>
            );
          })}
          {equipos.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Todavía no hay equipos definidos dentro de las áreas.</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px' }}>
            <Select value={newEquipoTeamId} onChange={e => setNewEquipoTeamId(e.target.value)}>
              <option value="">Área…</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.bay} · {t.name}</option>)}
            </Select>
          </div>
          <div style={{ flex: '2 1 200px' }}>
            <Input placeholder="Nombre del nuevo equipo" value={newEquipoName} onChange={e => setNewEquipoName(e.target.value)} />
          </div>
          <Btn onClick={() => { if (newEquipoName.trim() && newEquipoTeamId) { onAddEquipo(newEquipoTeamId, newEquipoName.trim()); setNewEquipoName(''); } }}><Plus size={15} /> Agregar equipo</Btn>
        </div>
      </Panel>

      <Panel>
        <Eyebrow>Usuarios y permisos</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 12 }}>
          {users.map(u => (
            <UserRow
              key={u.id} user={u} team={teams.find(t => t.id === u.teamId)} teams={teams} equipos={equipos}
              onSaveProfile={onSaveProfile} onTogglePermiso={onTogglePermiso}
              onUploadAvatar={onUploadAvatar} onUploadDpuPdf={onUploadDpuPdf} onViewDpuPdf={onViewDpuPdf}
              vacaciones={vacaciones} onReviewVacation={onReviewVacation}
            />
          ))}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', background: 'var(--panel-alt)', borderRadius: 12, padding: 14, lineHeight: 1.6 }}>
          Para dar de alta a una persona nueva: ve a tu proyecto de Supabase → <strong>Authentication → Users → Add user</strong>,
          captura su correo y una contraseña temporal. En cuanto se cree, aparecerá aquí automáticamente — solo falta que le asignes
          área, equipo, puesto, rol y permisos. Para quitarle el acceso a alguien, bórralo desde esa misma pantalla de Supabase.
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DESEMPEÑO — contenedor con pestañas internas: Mi DPU / KPI / Balanced Scorecard
// ---------------------------------------------------------------------------
function DesempenoView(props) {
  const { canSeeBSC, isAdmin } = props;
  const showBsc = isAdmin || canSeeBSC;
  const [tab, setTab] = useState('kpis');
  const tabs = [
    { id: 'kpis', label: 'KPI' },
    ...(showBsc ? [{ id: 'bsc', label: 'Balanced Scorecard' }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {tabs.length > 1 && (
        <div className="no-print" style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px', marginRight: 14,
              fontSize: 14, fontWeight: tab === t.id ? 700 : 500, color: tab === t.id ? 'var(--text)' : 'var(--text-dim)',
              borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
            }}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {tab === 'kpis' && <KPIsView user={props.user} teams={props.teams} kpis={props.kpis} onUpdateActual={props.onUpdateActual} />}
      {tab === 'bsc' && showBsc && <BSCView kpis={props.kpis} teams={props.teams} />}
    </div>
  );
}

function EquipoView({ user, teams, equipos, users, vacaciones, onSaveProfile, onUploadAvatar, onViewDpuPdf, onReviewVacation }) {
  const team = teams.find(t => t.id === user.teamId);
  const misCompaneros = users.filter(u => u.teamId === user.teamId && u.id !== user.id);
  const misEquipos = equipos.filter(e => e.teamId === user.teamId);
  const idsEquipo = new Set(misCompaneros.map(u => u.id));
  const pendientesEquipo = vacaciones.filter(v => v.estado === 'pendiente' && idsEquipo.has(v.personaId));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {pendientesEquipo.length > 0 && (
        <Panel>
          <Eyebrow>Solicitudes de vacaciones pendientes</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendientesEquipo.map(v => {
              const persona = users.find(u => u.id === v.personaId);
              return (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ flex: 1 }}>{persona ? persona.name : '—'}: {v.fechaInicio} → {v.fechaFin} ({v.dias} día{v.dias === 1 ? '' : 's'})</span>
                  <Btn variant="ghost" onClick={() => onReviewVacation(v.id, 'aprobada')} style={{ padding: '4px 10px', fontSize: 12 }}>Aprobar</Btn>
                  <Btn variant="danger" onClick={() => onReviewVacation(v.id, 'rechazada')} style={{ padding: '4px 10px', fontSize: 12 }}>Rechazar</Btn>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
      <Panel>
        <Eyebrow>{team ? `Personas en ${team.name}` : 'Personas de tu área'}</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {misCompaneros.map(u => (
            <LiderPersonaRow
              key={u.id} persona={u} equipos={misEquipos} onSaveProfile={onSaveProfile}
              onUploadAvatar={onUploadAvatar} onViewDpuPdf={onViewDpuPdf}
              vacaciones={vacaciones.filter(v => v.personaId === u.id)} onReviewVacation={onReviewVacation}
            />
          ))}
          {misCompaneros.length === 0 && <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>Todavía no hay más personas en tu área.</div>}
        </div>
      </Panel>
    </div>
  );
}

function LiderPersonaRow({ persona, equipos, onSaveProfile, onUploadAvatar, onViewDpuPdf, vacaciones, onReviewVacation }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ puesto: persona.puesto, jefe: persona.jefe, equipoId: persona.equipoId || '', funciones: (persona.funciones || []).join('\n') });

  function save() {
    onSaveProfile(persona.id, {
      name: persona.name, role: persona.role, teamId: persona.teamId,
      puesto: form.puesto, jefe: form.jefe, equipoId: form.equipoId || null,
      funciones: form.funciones.split('\n').map(s => s.trim()).filter(Boolean),
    });
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
        <Avatar url={persona.avatarUrl} name={persona.name} size={28} />
        <span style={{ flex: 1 }}>{persona.name} — {persona.puesto}</span>
        <span style={{ color: 'var(--text-dim)', width: 100 }}>{ROLE_LABEL[persona.role]}</span>
        <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Editar
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 10, marginLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <AvatarUploader persona={persona} onUploadAvatar={onUploadAvatar} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Input placeholder="Puesto" value={form.puesto} onChange={e => setForm({ ...form, puesto: e.target.value })} />
            <Input placeholder="Jefe directo" value={form.jefe} onChange={e => setForm({ ...form, jefe: e.target.value })} />
            <Select value={form.equipoId} onChange={e => setForm({ ...form, equipoId: e.target.value })}>
              <option value="">Sin equipo específico</option>
              {equipos.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
            </Select>
          </div>
          <textarea
            placeholder="Funciones clave (una por línea)" value={form.funciones} rows={3}
            onChange={e => setForm({ ...form, funciones: e.target.value })}
            style={{ width: '100%', boxSizing: 'border-box', background: '#fff', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', padding: '10px 12px', fontSize: 14, fontFamily: "'Plus Jakarta Sans', sans-serif", resize: 'vertical' }}
          />
          <Btn onClick={save} style={{ alignSelf: 'flex-start' }}>Guardar cambios</Btn>
          <DpuPdfUploader persona={persona} onViewDpuPdf={onViewDpuPdf} canUpload={false} />
          {vacaciones.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Vacaciones</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {vacaciones.map(v => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ flex: 1 }}>{v.fechaInicio} → {v.fechaFin} ({v.dias} día{v.dias === 1 ? '' : 's'})</span>
                    {v.estado === 'pendiente' ? (
                      <>
                        <Btn variant="ghost" onClick={() => onReviewVacation(v.id, 'aprobada')} style={{ padding: '4px 10px', fontSize: 12 }}>Aprobar</Btn>
                        <Btn variant="danger" onClick={() => onReviewVacation(v.id, 'rechazada')} style={{ padding: '4px 10px', fontSize: 12 }}>Rechazar</Btn>
                      </>
                    ) : (
                      <span style={{ color: VAC_ESTADO_COLOR[v.estado], fontWeight: 600 }}>{VAC_ESTADO_LABEL[v.estado]}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>El rol y el área solo los puede cambiar un administrador.</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// APP PRINCIPAL
// ---------------------------------------------------------------------------
export default function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [teams, setTeams] = useState([]);
  const [equipos, setEquipos] = useState([]);
  const [users, setUsers] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [okrsEquipo, setOkrsEquipo] = useState([]);
  const [activities, setActivities] = useState([]);
  const [vacaciones, setVacaciones] = useState([]);
  const [empresaName, setEmpresaName] = useState(DEFAULT_COMPANY_NAME);
  const [view, setView] = useState('inicio');
  const [loadError, setLoadError] = useState('');

  const fetchAll = useCallback(async (sess) => {
    setLoadError('');
    const [{ data: teamRows, error: e1 }, { data: profileRows, error: e2 }, { data: equipoRows, error: e2b }, { data: empresaRows, error: e2c }] = await Promise.all([
      supabase.from('teams').select('*').order('bay'),
      supabase.from('profiles').select('*'),
      supabase.from('equipos').select('*'),
      supabase.from('empresa').select('*').limit(1),
    ]);
    if (e1 || e2 || e2b || e2c) { setLoadError((e1 || e2 || e2b || e2c).message); return; }

    const mappedTeams = (teamRows || []).map(mapTeam);
    const mappedEquipos = (equipoRows || []).map(mapEquipo);
    const mappedUsers = (profileRows || []).map(mapProfile);
    const usersById = Object.fromEntries(mappedUsers.map(u => [u.id, u]));

    const [{ data: kpiRows, error: e3 }, { data: okrRows, error: e4 }, { data: actRows, error: e5 }, { data: vacRows, error: e6 }] = await Promise.all([
      supabase.from('kpis').select('*, kpi_historial(fecha, valor)'),
      supabase.from('okrs_equipo').select('*, okr_krs(*)'),
      supabase.from('activities').select('*, activity_comentarios(*)').order('created_at', { ascending: false }),
      supabase.from('vacaciones').select('*').order('created_at', { ascending: false }),
    ]);
    if (e3 || e4 || e5 || e6) { setLoadError((e3 || e4 || e5 || e6).message); return; }

    setTeams(mappedTeams);
    setEquipos(mappedEquipos);
    setUsers(mappedUsers);
    setKpis((kpiRows || []).map(mapKpi));
    setOkrsEquipo((okrRows || []).map(mapOkr));
    setActivities((actRows || []).map(a => mapActivity(a, usersById)));
    setVacaciones((vacRows || []).map(mapVacacion));
    if (empresaRows && empresaRows[0]) setEmpresaName(empresaRows[0].name);

    const me = usersById[sess.user.id];
    setCurrentUser(me || null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) fetchAll(data.session).finally(() => setLoading(false));
      else setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess) { setLoading(true); fetchAll(sess).finally(() => setLoading(false)); }
      else { setCurrentUser(null); setTeams([]); setEquipos([]); setUsers([]); setKpis([]); setOkrsEquipo([]); setActivities([]); }
    });
    return () => sub.subscription.unsubscribe();
  }, [fetchAll]);

  function logout() { supabase.auth.signOut(); }

  // ---- Mutaciones: cada una escribe en Supabase y luego refresca los datos ----
  async function updateActual(id, val) {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    await supabase.from('kpis').update({ actual: num }).eq('id', id);
    fetchAll(session);
  }
  async function updateKrActual(krId, val) {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    await supabase.from('okr_krs').update({ actual: num }).eq('id', krId);
    fetchAll(session);
  }
  async function addOkr(teamId, objetivo) {
    const { data, error } = await supabase.from('okrs_equipo').insert({ team_id: teamId, objetivo }).select().single();
    if (!error && data) {
      await supabase.from('okr_krs').insert({ okr_id: data.id, kr: 'Nuevo resultado clave', meta: 100, actual: 0, unidad: '%', mejor_mayor: true });
    }
    fetchAll(session);
  }
  async function updateStatus(id, estado) {
    await supabase.from('activities').update({ estado }).eq('id', id);
    fetchAll(session);
  }
  async function addActivity({ titulo, asignadoAUsername, fecha }) {
    const assignee = users.find(u => u.username === asignadoAUsername);
    if (!assignee) return;
    await supabase.from('activities').insert({ titulo, estado: 'pendiente', asignado_a: assignee.id, team_id: assignee.teamId, fecha });
    fetchAll(session);
  }
  async function removeActivity(id) {
    await supabase.from('activities').delete().eq('id', id);
    fetchAll(session);
  }
  async function addComment(activityId, texto) {
    await supabase.from('activity_comentarios').insert({ activity_id: activityId, autor_id: currentUser.id, texto });
    fetchAll(session);
  }
  async function addTeam(name) {
    const nextBay = String(teams.length + 1).padStart(2, '0');
    await supabase.from('teams').insert({ bay: nextBay, name });
    fetchAll(session);
  }
  async function removeTeam(id) {
    await supabase.from('teams').delete().eq('id', id);
    fetchAll(session);
  }
  async function addEquipo(teamId, name) {
    await supabase.from('equipos').insert({ team_id: teamId, name });
    fetchAll(session);
  }
  async function removeEquipo(id) {
    await supabase.from('equipos').delete().eq('id', id);
    fetchAll(session);
  }
  async function saveEmpresa(name) {
    const { data } = await supabase.from('empresa').select('id').limit(1);
    if (data && data[0]) {
      await supabase.from('empresa').update({ name }).eq('id', data[0].id);
      fetchAll(session);
    }
  }
  async function saveProfile(id, fields) {
    await supabase.from('profiles').update({
      name: fields.name, puesto: fields.puesto, jefe: fields.jefe, role: fields.role,
      team_id: fields.teamId, equipo_id: fields.equipoId, funciones: fields.funciones,
      ...(fields.fechaIngreso !== undefined ? { fecha_ingreso: fields.fechaIngreso } : {}),
      ...(fields.diasVacacionesDisponibles !== undefined ? { dias_vacaciones_disponibles: fields.diasVacacionesDisponibles } : {}),
    }).eq('id', id);
    fetchAll(session);
  }
  async function togglePermiso(userId, key) {
    const u = users.find(x => x.id === userId);
    if (!u) return;
    const next = { ...PERMISOS_DEFAULT, ...u.permisos, [key]: !u.permisos[key] };
    await supabase.from('profiles').update({ permisos: next }).eq('id', userId);
    fetchAll(session);
  }
  async function uploadAvatar(personId, file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${personId}/avatar.${ext}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (error) { setLoadError(error.message); return; }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    await supabase.from('profiles').update({ avatar_url: `${data.publicUrl}?t=${Date.now()}` }).eq('id', personId);
    fetchAll(session);
  }
  async function uploadDpuPdf(personId, file) {
    const path = `${personId}/dpu.pdf`;
    const { error } = await supabase.storage.from('dpu-docs').upload(path, file, { upsert: true });
    if (error) { setLoadError(error.message); return; }
    await supabase.from('profiles').update({ dpu_pdf_path: path }).eq('id', personId);
    fetchAll(session);
  }
  async function viewDpuPdf(path) {
    const { data, error } = await supabase.storage.from('dpu-docs').createSignedUrl(path, 60);
    if (error) { setLoadError(error.message); return; }
    window.open(data.signedUrl, '_blank');
  }
  async function requestVacation(fechaInicio, fechaFin, dias) {
    await supabase.from('vacaciones').insert({ persona_id: currentUser.id, fecha_inicio: fechaInicio, fecha_fin: fechaFin, dias, estado: 'pendiente' });
    fetchAll(session);
  }
  async function cancelVacation(id) {
    await supabase.from('vacaciones').delete().eq('id', id);
    fetchAll(session);
  }
  async function reviewVacation(id, estado) {
    await supabase.from('vacaciones').update({ estado, revisado_por: currentUser.id, revisado_at: new Date().toISOString() }).eq('id', id);
    fetchAll(session);
  }

  const fontImport = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
      :root {
        --bg: #F1F2F5; --panel: #FFFFFF; --panel-alt: #EDEEF1; --border: #E3E5E9;
        --text: #16181D; --text-dim: #7B8290; --dark: #45474B; --blue: #2F7FE0;
        --blue-soft: #EAF3FF; --green: #7C9A4E; --amber: #C98A3E; --red: #B6463D;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
      @media print { .no-print { display: none !important; } }
    `}</style>
  );

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
        {fontImport}Cargando {empresaName} OS…
      </div>
    );
  }

  if (!session || !currentUser) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        {fontImport}
        <LoginScreen onLogin={() => {}} companyName={empresaName} />
        {loadError && <div style={{ textAlign: 'center', color: 'var(--red)', fontSize: 13, marginTop: -8 }}>{loadError}</div>}
      </div>
    );
  }

  const isAdmin = currentUser.role === 'admin';
  const isLider = currentUser.role === 'lider';
  const canManageActs = hasPerm(currentUser, 'gestionarActividades');
  const canSeeBSC = hasPerm(currentUser, 'verBSC');
  const NAV_FULL = [
    { id: 'inicio', label: 'Inicio', icon: Home },
    { id: 'trabajo', label: 'Mi trabajo', icon: ClipboardList },
    { id: 'desempeno', label: 'Desempeño', icon: BarChart3 },
    { id: 'objetivos', label: 'Objetivos', icon: Target },
    { id: 'equipo', label: 'Mi Equipo', icon: Users2 },
    { id: 'admin', label: 'Administración', icon: Settings },
  ];
  const allowedIds = ['inicio', 'trabajo', 'desempeno', 'objetivos', ...(isLider ? ['equipo'] : []), ...(isAdmin ? ['admin'] : [])];
  const NAV = NAV_FULL.filter(n => allowedIds.includes(n.id));
  const team = teams.find(t => t.id === currentUser.teamId);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Plus Jakarta Sans', sans-serif", display: 'flex' }}>
      {fontImport}
      <div className="no-print" style={{ width: 224, background: 'var(--panel-alt)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '20px 16px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 14 }}>{empresaName.charAt(0).toUpperCase()}</span>
          </div>
          <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: '-0.02em' }}>{empresaName.toLowerCase()}<span style={{ color: 'var(--blue)' }}>OS</span></span>
        </div>
        <div style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {NAV.map(n => {
            const Icon = n.icon;
            const active = view === n.id;
            return (
              <button key={n.id} onClick={() => setView(n.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
                background: active ? '#fff' : 'transparent', border: 'none', cursor: 'pointer',
                color: active ? 'var(--text)' : 'var(--text-dim)', fontSize: 14, fontWeight: active ? 600 : 500, textAlign: 'left',
                boxShadow: active ? '0 1px 2px rgba(16,24,32,0.06)' : 'none',
              }}>
                <Icon size={16} /> {n.label}
              </button>
            );
          })}
        </div>
        <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
          <button onClick={() => setView('perfil')} style={{
            all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, width: '100%',
            padding: 8, marginLeft: -8, marginTop: -8, borderRadius: 10,
            background: view === 'perfil' ? '#fff' : 'transparent',
            boxShadow: view === 'perfil' ? '0 1px 2px rgba(16,24,32,0.06)' : 'none',
          }}>
            <Avatar url={currentUser.avatarUrl} name={currentUser.name} size={32} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{currentUser.name} — {currentUser.puesto}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{ROLE_LABEL[currentUser.role]}{team ? ` · ${team.name}` : ''}</div>
            </div>
          </button>
          <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-dim)', padding: '8px 10px', cursor: 'pointer', fontSize: 13, width: '100%' }}>
            <LogOut size={13} /> Cerrar sesión
          </button>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 10, textAlign: 'center', opacity: 0.6 }}>{APP_VERSION}</div>
        </div>
      </div>

      <div style={{ flex: 1, padding: 28, overflow: 'auto' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{view === 'perfil' ? 'Mi Perfil' : NAV.find(n => n.id === view)?.label}</div>
        </div>

        {loadError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{loadError}</div>}

        {view === 'inicio' && (
          <HomeView
            user={currentUser} teams={teams} equipos={equipos} kpis={kpis} okrsEquipo={okrsEquipo} activities={activities}
            vacaciones={vacaciones} users={users} onGo={setView}
          />
        )}
        {view === 'perfil' && (
          <DPUView
            user={currentUser} teams={teams} equipos={equipos} kpis={kpis} okrsEquipo={okrsEquipo}
            vacaciones={vacaciones}
            onUploadAvatar={uploadAvatar} onViewDpuPdf={viewDpuPdf}
            onRequestVacation={requestVacation} onCancelVacation={cancelVacation}
          />
        )}
        {view === 'trabajo' && (
          <ActividadesView
            user={currentUser} teams={teams} users={users} activities={activities}
            onUpdateStatus={updateStatus} onAddActivity={addActivity} onRemoveActivity={removeActivity} onAddComment={addComment}
          />
        )}
        {view === 'desempeno' && (
          <DesempenoView
            user={currentUser} teams={teams} kpis={kpis}
            onUpdateActual={updateActual} isAdmin={isAdmin} canSeeBSC={canSeeBSC}
          />
        )}
        {view === 'objetivos' && <OKRsView user={currentUser} teams={teams} okrsEquipo={okrsEquipo} onUpdateKrActual={updateKrActual} onAddOkr={addOkr} />}
        {view === 'equipo' && isLider && (
          <EquipoView
            user={currentUser} teams={teams} equipos={equipos} users={users} vacaciones={vacaciones} onSaveProfile={saveProfile}
            onUploadAvatar={uploadAvatar} onViewDpuPdf={viewDpuPdf} onReviewVacation={reviewVacation}
          />
        )}
        {view === 'admin' && isAdmin && (
          <AdminView
            empresaName={empresaName} teams={teams} equipos={equipos} users={users} vacaciones={vacaciones}
            onSaveEmpresa={saveEmpresa} onAddTeam={addTeam} onRemoveTeam={removeTeam}
            onAddEquipo={addEquipo} onRemoveEquipo={removeEquipo} onSaveProfile={saveProfile} onTogglePermiso={togglePermiso}
            onUploadAvatar={uploadAvatar} onUploadDpuPdf={uploadDpuPdf} onViewDpuPdf={viewDpuPdf} onReviewVacation={reviewVacation}
          />
        )}
      </div>
    </div>
  );
}

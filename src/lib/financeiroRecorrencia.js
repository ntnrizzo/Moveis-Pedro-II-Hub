const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RECORRENCIA_TIPO = 'Mensal';

export const RECORRENCIA_OPTIONS = [
  { value: 'Semanal', label: 'Semanal' },
  { value: 'Quinzenal', label: 'Quinzenal' },
  { value: 'Mensal', label: 'Mensal' },
  { value: 'Trimestral', label: 'Trimestral' },
  { value: 'Semestral', label: 'Semestral' },
  { value: 'Anual', label: 'Anual' },
];

const RECORRENCIA_VALUES = new Set(RECORRENCIA_OPTIONS.map((option) => option.value));

export function normalizeFinanceiroText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function normalizeCategoriaId(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

export function buildCategoriaFilterValue(categoria) {
  const categoriaId = normalizeCategoriaId(categoria?.id);
  if (categoriaId) return `id:${categoriaId}`;

  const categoriaNome = normalizeFinanceiroText(categoria?.nome);
  if (categoriaNome) return `nome:${categoriaNome}`;

  return '';
}

export function getLancamentoCategoriaFilterValue(lancamento) {
  const categoriaId = normalizeCategoriaId(lancamento?.categoria_id);
  if (categoriaId) return `id:${categoriaId}`;

  const categoriaNome = normalizeFinanceiroText(lancamento?.categoria_nome);
  if (categoriaNome) return `nome:${categoriaNome}`;

  return '';
}

export function lancamentoMatchesCategoriaFilter(lancamento, categoriaFiltro) {
  if (!categoriaFiltro || categoriaFiltro === 'todos') return true;

  const categoriaLancamento = getLancamentoCategoriaFilterValue(lancamento);
  if (categoriaLancamento === categoriaFiltro) return true;

  if (categoriaFiltro.startsWith('nome:')) {
    return normalizeFinanceiroText(lancamento?.categoria_nome) === categoriaFiltro.slice(5);
  }

  return false;
}

export function getLancamentoCategoriaLabel(lancamento, categorias = []) {
  if (lancamento?.categoria_nome) return lancamento.categoria_nome;

  const categoriaId = normalizeCategoriaId(lancamento?.categoria_id);
  if (!categoriaId) return '';

  const categoria = categorias.find((item) => normalizeCategoriaId(item?.id) === categoriaId);
  return categoria?.nome || '';
}

export function findCategoriaByNames(categorias = [], nomes = []) {
  if (!Array.isArray(categorias) || categorias.length === 0) return null;

  const nomesNormalizados = new Set(
    nomes
      .map((nome) => normalizeFinanceiroText(nome))
      .filter(Boolean)
  );

  return categorias.find((categoria) => nomesNormalizados.has(normalizeFinanceiroText(categoria?.nome)));
}

export function getRecorrenciaTipo(recorrenciaTipo) {
  return RECORRENCIA_VALUES.has(recorrenciaTipo) ? recorrenciaTipo : DEFAULT_RECORRENCIA_TIPO;
}

export function getRecorrenciaAnchorDate(lancamento) {
  return lancamento?.data_vencimento || lancamento?.data_lancamento || null;
}

function parseIsoDate(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;

  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addMonthsClamped(date, months) {
  const target = new Date(date.getTime());
  const desiredDay = target.getDate();
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDayOfMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(desiredDay, lastDayOfMonth));
  return target;
}

export function addRecorrenciaToDate(isoDate, recorrenciaTipo) {
  const date = parseIsoDate(isoDate);
  if (!date) return null;

  switch (getRecorrenciaTipo(recorrenciaTipo)) {
    case 'Semanal':
      date.setDate(date.getDate() + 7);
      return toIsoDate(date);
    case 'Quinzenal':
      date.setDate(date.getDate() + 15);
      return toIsoDate(date);
    case 'Mensal':
      return toIsoDate(addMonthsClamped(date, 1));
    case 'Trimestral':
      return toIsoDate(addMonthsClamped(date, 3));
    case 'Semestral':
      return toIsoDate(addMonthsClamped(date, 6));
    case 'Anual':
      return toIsoDate(addMonthsClamped(date, 12));
    default:
      return toIsoDate(addMonthsClamped(date, 1));
  }
}

export function diffDaysFromToday(referenceDate, targetIsoDate) {
  const date = parseIsoDate(targetIsoDate);
  if (!date) return null;

  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / DAY_IN_MS);
}

export function isLancamentoSugestaoRecorrencia(lancamento) {
  if (!lancamento?.data_vencimento) return false;
  if (lancamento?.recorrente) return false;
  if (lancamento?.origem_automatica || lancamento?.origem_automática) return false;
  // Lançamentos gerados automaticamente pelo RecorrentesManager têm origem_tipo='recorrencia'
  if (lancamento?.origem_tipo === 'recorrencia') return false;
  // Lançamentos com origem_ref são filhos de recorrentes
  if (lancamento?.origem_ref) return false;

  const tipo = normalizeFinanceiroText(lancamento?.tipo);
  const status = normalizeFinanceiroText(lancamento?.status);

  if (!['saida', 'saída'].includes(tipo)) return false;
  if (status === 'pago' || status === 'cancelado') return false;

  return true;
}

export function buildRecurringOccurrenceKey(lancamentoId, competenciaDate) {
  const id = lancamentoId === null || lancamentoId === undefined ? '' : String(lancamentoId);
  return id && competenciaDate ? `recorrencia:${id}:${competenciaDate}` : '';
}

export function isRecurringOccurrenceDuplicate(lancamentoOriginal, competenciaDate, todosLancamentos = []) {
  const origemRef = buildRecurringOccurrenceKey(lancamentoOriginal?.id, competenciaDate);
  const categoriaIdOriginal = normalizeCategoriaId(lancamentoOriginal?.categoria_id);
  const anchorDate = getRecorrenciaAnchorDate(lancamentoOriginal);

  // Se a data de competência for a própria data âncora do lançamento original,
  // essa ocorrência já é representada pelo próprio lançamento original.
  if (anchorDate === competenciaDate) return true;

  return todosLancamentos.some((lancamento) => {
    if (origemRef && lancamento?.origem_ref === origemRef) return true;

    const categoriaIdAtual = normalizeCategoriaId(lancamento?.categoria_id);
    const dateMatch = (lancamento?.data_vencimento || lancamento?.data_lancamento) === competenciaDate;

    if (lancamento?.id === lancamentoOriginal?.id && dateMatch) return true;

    return (
      dateMatch &&
      lancamento?.descricao === lancamentoOriginal?.descricao &&
      Number(lancamento?.valor) === Number(lancamentoOriginal?.valor) &&
      categoriaIdAtual === categoriaIdOriginal
    );
  });
}

export function isLancamentoRecorrente(lancamento) {
  if (!lancamento) return false;
  if (lancamento.recorrente === true) return true;
  if (lancamento.origem_tipo === 'recorrencia') return true;
  if (lancamento.origem_ref && String(lancamento.origem_ref).startsWith('recorrencia:')) return true;
  return false;
}

export function extractRecorrenciaParentId(lancamento) {
  if (!lancamento) return null;
  if (lancamento.recorrente === true) return lancamento.id;
  if (lancamento.origem_ref && String(lancamento.origem_ref).startsWith('recorrencia:')) {
    const parts = String(lancamento.origem_ref).split(':');
    if (parts.length >= 2) {
      const parsed = parseInt(parts[1], 10);
      return !isNaN(parsed) ? parsed : parts[1];
    }
  }
  return null;
}

export async function encerrarEExcluirRecorrencia(lancamento, base44) {
  if (!lancamento?.id) throw new Error('Lançamento não informado.');
  const { supabase } = await import('@/lib/supabase');
  const { data, error } = await supabase.rpc('delete_financial_recurrence', { p_id: lancamento.id });
  if (error) throw error;
  if (!data?.deleted_ids?.length) throw new Error('Nenhum lançamento foi removido.');
  try {
    await base44.entities.AuditLog.create({
      acao: 'DELETE_RECURRENCE', tabela: 'lancamentos_financeiros',
      detalhes: { record_id: lancamento.id, deleted_ids: data.deleted_ids },
    });
  } catch {
    console.warn('Exclusão concluída; não foi possível registrar a auditoria complementar.');
  }
  return data;
}

import React, { useMemo } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { MessageCircle } from 'lucide-react';
import type { FlowConfig, FunnelGraphStats } from './funnelApi';
import { MF_EDGES, MF_NODES, MF_NODE_FLOW, WHY_TEXT, deriveWhen, edgeLabel, isApprovedTemplate, type MfNode, type MfSide, type MfTone } from './funnelGraph';

const POS: Record<MfSide, Position> = { top: Position.Top, bottom: Position.Bottom, left: Position.Left, right: Position.Right };
const SIDES: MfSide[] = ['top', 'bottom', 'left', 'right'];
const EDGE_COLOR: Record<MfTone, string> = { success: '#16A34A', neutral: '#6B7280', danger: '#DC2626' };
const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString() : '—');

interface VariantView {
  label: string;
  letter?: string;
  template: string;
  approved: boolean;
  /** Messages sent with this template in the period; null = not available. */
  sent: number | null;
  /** Offer B/C only: promo-code redemptions. undefined = not an offer variant. */
  used?: number | null;
  usedNote?: string;
}

/** on = step is switched on in a running flow; flow_paused = step on but its flow is paused; step_off = step paused. */
type StepState = 'on' | 'flow_paused' | 'step_off' | 'none';

interface NodeData extends Record<string, unknown> {
  node: MfNode;
  count: number | null;
  note?: string;
  when?: string;
  variants?: VariantView[];
  state: StepState;
  selected: boolean;
}

const STATE_LABEL: Record<StepState, string> = { on: 'Running', flow_paused: 'Flow paused', step_off: 'Step off', none: 'No live flow yet' };
const STATE_CLASS: Record<StepState, string> = {
  on: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  flow_paused: 'bg-amber-50 text-amber-700 border-amber-200',
  step_off: 'bg-slate-100 text-slate-600 border-slate-200',
  none: 'bg-white text-slate-400 border-slate-200'
};

function Handles() {
  return (
    <>
      {SIDES.map((s) => (
        <React.Fragment key={s}>
          <Handle id={`t-${s}`} type="target" position={POS[s]} isConnectable={false} style={{ opacity: 0 }} />
          <Handle id={`s-${s}`} type="source" position={POS[s]} isConnectable={false} style={{ opacity: 0 }} />
        </React.Fragment>
      ))}
    </>
  );
}

function StepNode({ data }: NodeProps<Node<NodeData>>) {
  const { node, variants } = data;
  const stepState = (data.state as StepState) || 'none';
  return (
    <div
      className={`${variants && variants.length > 2 ? 'w-[330px]' : 'w-[250px]'} cursor-pointer rounded-xl border bg-white p-3 text-left shadow-sm ${
        data.state === 'on' ? 'border-[#d4d4d4]' : 'border-dashed border-[#d4d4d4]'
      } ${data.selected ? 'ring-2 ring-[#c91e2f]' : 'hover:border-[#c91e2f]'}`}
    >
      <Handles />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {node.stage && <div className="text-[11px] text-slate-500">Stage {node.stage}</div>}
          <div className="text-sm font-semibold leading-tight text-black">{node.title}</div>
          {data.when && <div className="text-xs text-slate-500 mt-0.5">{data.when}</div>}
        </div>
        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${STATE_CLASS[stepState]}`}>{STATE_LABEL[stepState]}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5" title={data.note}>
        <span className="text-base font-semibold tabular-nums text-black">{fmt(data.count)}</span>
        <span className="text-[11px] text-slate-500">Reached</span>
      </div>
      {variants && (
        <div className={`mt-2 grid gap-1.5 ${variants.length > 2 ? (variants.length > 3 ? 'grid-cols-2' : 'grid-cols-3') : 'grid-cols-2'}`}>
          {variants.map((v: VariantView, i: number) => (
            <div key={i} className="rounded-md border border-[#e5e5e5] bg-[#fafafa] px-2 py-1.5 min-w-0">
              {v.letter && <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-black text-white text-[10px] font-bold">{v.letter}</span>}
              <div className="mt-1 flex items-center gap-1 min-w-0">
                <MessageCircle size={11} className={v.approved ? 'text-emerald-600 shrink-0' : 'text-amber-500 shrink-0'} aria-hidden />
                <code className="text-[10px] truncate text-slate-800" title={v.template}>{v.template}</code>
              </div>
              {v.label && <div className="text-[11px] leading-snug mt-1 line-clamp-2 text-slate-500">{v.label}</div>}
              <div className="text-[11px] mt-1 tabular-nums text-slate-700">
                Sent <span className="font-semibold">{fmt(v.sent)}</span>
              </div>
              {v.used !== undefined && (
                <div className="text-[11px] tabular-nums text-slate-700" title={v.usedNote}>
                  Promo used <span className="font-semibold">{fmt(v.used)}</span>
                </div>
              )}
              {!v.approved && <div className="text-[10px] text-amber-600 mt-0.5">New template, needs approval</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TermNode({ data }: NodeProps<Node<NodeData>>) {
  const { node } = data;
  const tone = node.kind === 'start' || node.kind === 'milestone' ? 'border-black text-black' : 'border-red-600 text-red-700';
  return (
    <div
      className={`cursor-pointer min-w-[150px] max-w-[220px] rounded-full border-2 bg-white px-4 py-2 text-center text-xs font-semibold ${tone} ${data.selected ? 'ring-2 ring-[#c91e2f]' : ''}`}
      title={data.note}
    >
      <Handles />
      {node.title}
      <span className="ml-1.5 tabular-nums opacity-80">{fmt(data.count)}</span>
    </div>
  );
}

const nodeTypes = { step: StepNode, term: TermNode };
const OPENING_VIEW = ['signup', 's1issue', 's1remind', 's1dead', 'offers', 'exitB', 'exitC', 'remB'].map((id) => ({ id }));

export function stepStateOf(nodeId: string, flows: FlowConfig[] | null): StepState {
  const ref = MF_NODE_FLOW[nodeId];
  const flow = ref && flows?.find((f) => f.id === ref.flowId);
  const step = flow?.steps.find((s) => s.id === ref.stepId);
  if (!flow || !step) return 'none';
  if (step.paused) return 'step_off';
  return flow.status === 'running' ? 'on' : 'flow_paused';
}

/** The templates a chart step really sends: what its live flow step says right now, else the plan in the graph file. */
function variantsOf(node: MfNode, flows: FlowConfig[] | null): { template: string; label: string }[] | undefined {
  const planned = node.variants;
  const ref = MF_NODE_FLOW[node.id];
  const step = ref && flows?.find((f) => f.id === ref.flowId)?.steps.find((s) => s.id === ref.stepId);
  if (!step || step.kind !== 'send_template') return planned;
  const label = (template: string) => planned?.find((p) => p.template === template)?.label ?? '';
  if (step.variants?.length) return step.variants.map((x) => ({ template: x.templateId, label: label(x.templateId) }));
  if (step.templateId) return [{ template: step.templateId, label: label(step.templateId) }];
  return planned;
}

export interface MembershipFlowChartProps {
  /** Real numbers; null while loading or when they could not be read (every number then shows a dash). */
  stats: FunnelGraphStats | null;
  flows: FlowConfig[] | null;
  onSelect?: (nodeId: string) => void;
  selectedId?: string | null;
  /** Days from the funnel definition: the numbers on the free-wash arrows are counted with these. */
  reminderDay?: number;
  expiryDay?: number;
}

export function MembershipFlowChart({ stats, flows, onSelect, selectedId, reminderDay = 5, expiryDay = 7 }: MembershipFlowChartProps) {
  const nodes = useMemo<Node<NodeData>[]>(
    () =>
      MF_NODES.map((n) => {
        const count = stats ? (stats.nodes[n.id] ?? null) : null;
        const whyKey = stats && count === null ? stats.why[n.id] : undefined;
        const list = n.kind === 'step' ? variantsOf(n, flows) : undefined;
        return {
          id: n.id,
          type: n.kind === 'step' ? 'step' : 'term',
          position: { x: n.x, y: n.y },
          draggable: false,
          data: {
            node: n,
            count,
            when: deriveWhen(n, flows),
            note: whyKey ? WHY_TEXT[whyKey] : count === null ? 'Not measured yet' : undefined,
            state: n.kind === 'step' ? stepStateOf(n.id, flows) : 'none',
            selected: selectedId === n.id,
            variants: list?.map((v, i, all): VariantView => {
              const offerCol = n.id === 'offers' && all.length > 1 && i > 0;
              const promo = offerCol ? (i === 1 ? stats?.promoRedemptions.offerB : stats?.promoRedemptions.offerC) : undefined;
              const why = offerCol && stats ? stats.why[i === 1 ? 'offerB' : 'offerC'] : undefined;
              return {
                letter: all.length > 1 ? 'ABC'[i] : undefined,
                label: v.label,
                template: v.template,
                approved: isApprovedTemplate(v.template),
                sent: stats?.templateSent ? (stats.templateSent[v.template] ?? 0) : null,
                used: offerCol ? (promo ?? null) : undefined,
                usedNote: why ? WHY_TEXT[why] : undefined
              };
            })
          }
        };
      }),
    [stats, flows, selectedId]
  );

  const edges = useMemo<Edge[]>(
    () =>
      MF_EDGES.map((e) => {
        const color = EDGE_COLOR[e.tone];
        const count = stats ? (stats.edges[e.id] ?? null) : null;
        return {
          id: e.id,
          source: e.from,
          sourceHandle: `s-${e.fromSide}`,
          target: e.to,
          targetHandle: `t-${e.toSide}`,
          type: 'smoothstep',
          label: !e.label ? undefined : `${edgeLabel(e, reminderDay, expiryDay)} · ${fmt(count)}`,
          labelStyle: { fontSize: 11, fill: '#404040' },
          labelBgStyle: { fill: '#FFFFFF', fillOpacity: 0.95 },
          labelBgPadding: [4, 2] as [number, number],
          style: { stroke: color, strokeWidth: 1.5, strokeDasharray: count === null ? '5 4' : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color }
        };
      }),
    [stats, reminderDay, expiryDay]
  );

  return (
    <div className="h-[820px] rounded-2xl border border-[#e5e5e5] bg-white overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        // The map is much taller than it is wide: open on stages 1 and 2 at a readable size, drag to see the rest.
        fitViewOptions={{ padding: 0.06, nodes: OPENING_VIEW }}
        minZoom={0.2}
        zoomOnScroll={false}
        preventScrolling={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={(_: React.MouseEvent, node: Node) => onSelect?.(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

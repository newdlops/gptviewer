export type RenderViewMode = 'auto' | 'code' | 'rendered';
export type MermaidRenderIssueSource = 'original' | 'wrapper' | 'custom';
export type MermaidRenderIssueSeverity = 'warning' | 'error';
export type MermaidRenderIssue = {
  message: string;
  severity: MermaidRenderIssueSeverity;
  source: MermaidRenderIssueSource;
};

export const renderViewModeStore = new Map<string, RenderViewMode>();
export const renderedMarkupStore = new Map<string, string>();
export const transformedMermaidSourceStore = new Map<string, string>();
export const transformedMermaidLabelStore = new Map<string, string>();
export const autoAdjustedViewportStore = new Map<string, string>();
export const mermaidRenderIssueStore = new Map<string, MermaidRenderIssue>();
export const customMermaidSourceStore = new Map<string, string>();

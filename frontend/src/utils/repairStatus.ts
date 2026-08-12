import { ThemeColors } from '@/src/theme';

export type RepairItemStatus = 'received' | 'with_karigar' | 'ready' | 'delivered';

// Shared everywhere a repair item's status is shown, so the label and color
// mean the same thing on every screen (list, order detail, Tag detail,
// outstanding report, tag search).
export const REPAIR_STATUS_LABEL: Record<RepairItemStatus, string> = {
  received: 'Received',
  with_karigar: 'Pending from Karigar',
  ready: 'Pending to Bill',
  delivered: 'Delivered',
};

export function repairStatusColors(status: RepairItemStatus, colors: ThemeColors): { bg: string; fg: string; border: string } {
  switch (status) {
    case 'received': return { bg: colors.info, fg: colors.onInfo, border: colors.info };
    case 'with_karigar': return { bg: colors.warning, fg: colors.onWarning, border: colors.warning };
    case 'ready': return { bg: colors.brandTertiary, fg: colors.brandPrimary, border: colors.brand };
    case 'delivered': return { bg: colors.success, fg: colors.onSuccess, border: colors.success };
    default: return { bg: colors.surfaceTertiary, fg: colors.onSurface, border: colors.border };
  }
}

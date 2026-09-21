/**
 * CloudPanels — 云面板容器,挂在 App.tsx 根部。
 * 由 projectsStore.panel 驱动:'projects' → 工程列表模态;'history' → 版本历史抽屉。
 */
import { useProjectsStore } from '../../stores/projectsStore';
import { ProjectListModal } from './ProjectListModal';
import { VersionHistoryDrawer } from './VersionHistoryDrawer';

export function CloudPanels(): JSX.Element | null {
  const panel = useProjectsStore((s) => s.panel);
  const close = (): void => useProjectsStore.getState().openPanel(null);
  if (panel === 'projects') return <ProjectListModal onClose={close} />;
  if (panel === 'history') return <VersionHistoryDrawer onClose={close} />;
  return null;
}

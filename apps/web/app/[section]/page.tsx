import { notFound } from 'next/navigation';
import { Dashboard } from '../../components/dashboard';
const sections = new Set([
  'dashboard',
  'signals',
  'orders',
  'positions',
  'trades',
  'strategies',
  'risk',
  'broker',
  'logs',
  'settings',
]);
export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!sections.has(section)) notFound();
  return <Dashboard section={section} />;
}

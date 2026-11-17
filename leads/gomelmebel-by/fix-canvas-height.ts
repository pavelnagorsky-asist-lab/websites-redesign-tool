// Одноразово: высота мобильного экрана на холсте под новый контент (после замены шрифта страница выросла).
import { stitchCall } from '../../scripts/lib/stitch.ts';
const name = 'projects/7374928701699833914';
const proj = await stitchCall('get_project', { name });
const inst = (proj.screenInstances ?? []).map((s: any) => (s.id === '6eba3d07651e4b27b7078294e3bbd1a0' ? { ...s, height: 5024 } : s));
await stitchCall('update_project', { name, screenInstances: inst, updateMask: ['screen_instances'] });
const after = await stitchCall('get_project', { name });
for (const s of after.screenInstances) console.log(s.id, s.width, s.height, s.x);

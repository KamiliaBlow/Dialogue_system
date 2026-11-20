/*
  Процедурные планеты для вступления брифинга: генератор (имя, класс, описание, характеристики)
  и сфера планеты.

  Поверхность строится по алгоритмам PixelPlanets (Deep-Fold, MIT — см. THIRD_PARTY_LICENSES.md):
  слои суши, воды, рек, озёр, кратеров и лавы, освещение полосами от точки света на диске
  и наклон оси. Пикселизация, дизеринг и цветовые схемы оригинала не используются — тона наши,
  а шум считается в 3D на поверхности сферы, чтобы планету можно было вращать и приближать без швов.
  Обычный скрипт: const Planet = BriefingPlanet(THREE).
*/
(function () {
'use strict';

window.BriefingPlanet = function (THREE) {
const DEG = Math.PI / 180;

/* kind — какой генератор PixelPlanets используется:
   0 «Islands» (вода + материки), 1 «Terran Wet» (суша с реками), 2 «Terran Dry», 3 «Ice World» (лёд + озёра),
   4 «No atmosphere» (грунт + кратеры), 5 «Lava World» (грунт + кратеры + лавовые реки). */
const TYPES = {
  terran:   { name:'Землеподобная',  kind:1, clouds:.5, water:'#3d7fb8', accent:'#7cc8ff', atmo:.9 },
  ocean:    { name:'Океаническая',   kind:0, clouds:.55, water:'#2f6fae', accent:'#6fb8ff', atmo:1,  cut:.633 },
  desert:   { name:'Пустынная',      kind:2, water:'#000000', accent:'#ffb36b', atmo:.55 },
  ice:      { name:'Ледяная',        kind:3, clouds:.35, water:'#2b5a7a', accent:'#bfe4ff', atmo:.6 },
  volcanic: { name:'Вулканическая',  kind:5, water:'#ff6a2c', accent:'#ff5a2c', atmo:.7 },
  barren:   { name:'Безатмосферная', kind:4, water:'#000000', accent:'#c9ccc4', atmo:0 },
  toxic:    { name:'Токсичная',      kind:0, clouds:.7, water:'#6f9a2a', accent:'#b6f26a', atmo:1,  cut:.56 },
};

/* ---------- генератор описаний ---------- */
function rng(seed) { let a = seed | 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pick = (R, a) => a[Math.floor(R() * a.length)];
const SYL = ['ка', 'тес', 'ра', 'ви', 'ор', 'лу', 'мар', 'се', 'до', 'кси', 'ан', 'тэ', 'ри', 'нос', 'ва', 'ле', 'кор', 'ис', 'та', 'гел', 'ми', 'дра', 'зе', 'ун', 'фа', 'ло', 'кей', 'са', 'тор', 'эл'];
const SUFFIX = ['', '', '', ' II', ' III', ' IV', ' Прайм', ' Майор', '-Б'];
const TEXT = {
  terran:   ['Умеренный мир с широкими континентами и неглубокими морями.', 'Климат мягкий, атмосфера пригодна для дыхания без масок.', 'Первая волна колонистов давно обжила побережья, глубинка до сих пор полудикая.'],
  desert:   ['Сухой каменистый мир, где вода сохранилась только в глубоких пластах.', 'Песчаные бури закрывают целые районы на недели.', 'Недра богаты тяжёлыми металлами — ради них сюда и пришли консорциумы.'],
  ice:      ['Мир вечной мерзлоты под тонкой разреженной атмосферой.', 'Под ледяным панцирем лежит жидкий океан, к которому ведут шахты.', 'Поселения держатся у геотермальных источников.'],
  ocean:    ['Почти вся поверхность скрыта глобальным океаном.', 'Суша — цепочки архипелагов и плавучие платформы.', 'Штормы здесь длятся сутками и легко топят тяжёлую технику.'],
  volcanic: ['Молодая планета с активной корой и реками лавы.', 'Атмосфера насыщена серой; без защиты техника быстро выходит из строя.', 'Термальные электростанции питают половину сектора.'],
  barren:   ['Безвоздушный мир, изрытый кратерами.', 'Перепады температур между днём и ночью рвут незащищённый металл.', 'На поверхности — только автоматические рудники и купола станций.'],
  toxic:    ['Влажный мир с ядовитой атмосферой и буйной чужой флорой.', 'Без герметичной брони пилоты не живут здесь и часа.', 'Биотехнологические корпорации платят за образцы втрое.'],
};
const HOOK = ['Сектор считается спорным: три корпорации претендуют на права добычи.', 'Орбиту контролирует флот колониальной администрации, но на поверхности её власть номинальна.',
  'После последнего конфликта связь с дальними поселениями работает с перебоями.', 'В последние месяцы участились нападения вооружённых групп на конвои.',
  'Поверхность почти не картографирована: данные разведки неполны.', 'Местное ополчение слабо и охотно нанимает пилотов со стороны.'];
const ATMO = { terran:'азот-кислородная', desert:'разреженная, азот-аргон', ice:'тонкая, азот-метан', ocean:'плотная, влажная', volcanic:'сернистая', barren:'отсутствует', toxic:'плотная, ядовитая' };
const TEMP = { terran:'−20…+35 °C', desert:'−40…+48 °C', ice:'−120…−15 °C', ocean:'+4…+30 °C', volcanic:'+30…+180 °C', barren:'−170…+120 °C', toxic:'+18…+60 °C' };
const REGION = ['Плато', 'Хребет', 'Долина', 'Равнина', 'Каньон', 'Предгорья', 'Бассейн', 'Перешеек'];

function generate(seed, type) {
  const R = rng(seed * 2654435761);
  type = type && TYPES[type] ? type : pick(R, Object.keys(TYPES));
  const syl = 2 + (R() < .4 ? 1 : 0); let name = ''; for (let i = 0; i < syl; i++) name += pick(R, SYL);
  name = name[0].toUpperCase() + name.slice(1) + pick(R, SUFFIX);
  const radius = Math.round(3200 + R() * 4800), g = (radius / 6370 * (.7 + R() * .6)).toFixed(2).replace('.', ',');
  const popRoll = R(), pop = type === 'barren' || type === 'toxic' ? (popRoll < .5 ? 'необитаема' : `≈ ${Math.round(2 + R() * 40)} тыс. (станции)`)
    : popRoll < .2 ? 'необитаема' : popRoll < .7 ? `≈ ${Math.round(20 + R() * 900)} тыс.` : `≈ ${(1 + R() * 40).toFixed(1).replace('.', ',')} млн`;
  const t = TEXT[type], desc = [t[0], pick(R, t.slice(1)), pick(R, HOOK)].join(' ');
  const region = `${pick(R, REGION)} ${pick(R, SYL)[0].toUpperCase()}${pick(R, SYL)}${pick(R, SYL)}`;
  return { show:true, name, designation:`HX-${1000 + Math.floor(R() * 8999)} ${'bcdef'[Math.floor(R() * 5)]}`, type, seed, desc, region,
    lat:Math.round((R() - .5) * 110), lon:Math.round((R() - .5) * 340),
    tilt:Math.round((R() - .5) * 60), clouds:Math.round((TYPES[type].clouds ? TYPES[type].clouds * (.7 + R() * .6) : 0) * 100) / 100, light:{ angle:Math.round(110 + R() * 60), dist:Math.round((.2 + R() * .14) * 100) / 100 },
    stats:[['Радиус', `${radius.toLocaleString('ru-RU')} км`], ['Гравитация', `${g} g`], ['Атмосфера', ATMO[type]], ['Температура', TEMP[type]],
      ['Сутки', `${Math.round(14 + R() * 40)} ч`], ['Население', pop]] };
}

/* ---------- шейдер (генерация по PixelPlanets) ---------- */
const VS = `varying vec3 vP;varying vec3 vN;void main(){vP=normalize(position);vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const FS = `
uniform vec3 uInk;uniform vec3 uWater;uniform vec3 uBg;uniform vec3 uOff;uniform vec3 uTarget;uniform vec2 uLight;
uniform float uKind;uniform float uSeed;uniform float uCut;uniform float uCloud;uniform float uZone;uniform float uMarkOn;uniform float uTicks;uniform float uClock;uniform vec3 uHot;uniform float uOp;uniform float uMark;uniform float uDetail;uniform float uTime;
varying vec3 vP;varying vec3 vN;
/* шум как в PixelPlanets (rand → value noise → fbm), но в 3D на поверхности сферы */
/* целочисленный хеш (pcg3d): дробные хеши на видеокарте изредка дают другой результат в последних битах,
   и целые участки суши «моргали»; целые числа считаются всегда одинаково */
uint pcg3(uvec3 v){v=v*1664525u+1013904223u;v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;v^=v>>16u;v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;return v.x^v.y^v.z;}
float rand(vec3 c){uvec3 q=uvec3(ivec3(floor(c))+ivec3(1<<20))+uvec3(uint(uSeed*1000.+.5));return float(pcg3(q)>>8)*(1./16777216.);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(mix(rand(i),rand(i+vec3(1,0,0)),u.x),mix(rand(i+vec3(0,1,0)),rand(i+vec3(1,1,0)),u.x),u.y),
             mix(mix(rand(i+vec3(0,0,1)),rand(i+vec3(1,0,1)),u.x),mix(rand(i+vec3(0,1,1)),rand(i+vec3(1,1,1)),u.x),u.y),u.z);}
/* fbm с октавами оригинала; форма не зависит от масштаба — при наезде камеры рельеф не меняется */
float fbm(vec3 p,int oct){float v=0.,s=.5;for(int i=0;i<8;i++){if(i>=oct)break;v+=noise(p)*s;p*=2.;s*=.5;}return v;}
/* облака PixelPlanets: круги + fbm, вытянуты вдоль широт */
float cloudNoise(vec3 q){vec3 i=floor(q),f=fract(q);float h=rand(i+77.);float m=length(f-.25-h*.5);float r=h*.25;return smoothstep(0.,r,m*.75);}
float circleNoise(vec3 q){vec3 i=floor(q),f=fract(q);float h=rand(i);float m=length(f-.25-h*.5);float r=h*.25;return smoothstep(r-.1*r,r,m);}
float crater(vec3 q){float c=1.;for(int i=0;i<2;i++)c*=circleNoise(q+float(i+1)+10.);return 1.-c;}
/* мягкий порог вместо пиксельной ступеньки: 1, когда a < b */
float lt(float a,float b){float w=fwidth(b-a)*.75+1e-4;return smoothstep(-w,w,b-a);}
/* усиление шума по полосам света, как в PixelPlanets, но с плавным переходом: резкие if давали разрывы, которые мерцали */
void lightWarp(float d,float b1,float b2,inout float f2,inout float f3,inout float f4){float k1=smoothstep(b1-.02,b1+.02,d),k2=smoothstep(b2-.02,b2+.02,d);
  f4*=mix(.9,1.05,k1);f2*=mix(1.,1.05,k1)*mix(1.,1.3,k2);f3*=mix(1.,1.05,k1)*mix(1.,1.4,k2);f4*=mix(1.,1.8,k2);}
float bands(float d,float b1,float b2,float c0,float c1,float c2){return mix(mix(c0,c1,lt(b1,d)),c2,lt(b2,d));}
void main(){
  vec3 P=normalize(vP);                          // нормализуем в пикселе: интерполяция по треугольникам давала «гранёный» круг
  int kind=int(uKind+.5);
  vec2 c=vec2(vN.x,-vN.y);                       // диск планеты на экране (ось y вниз, как UV в оригинале)
  vec2 D=c*.5+.5, DS=c/(max(vN.z,0.)+1.)*.5+.5;  // D — плоский диск, DS — «сферифицированный»
  vec3 uv=P*.5+uOff;                            // точка поверхности (вращается вместе с планетой)
  vec3 Lo=vec3(uLight,0.);
  float dl=distance(D,uLight),dls=distance(DS,uLight);
  /* монохром: яркость суши по полосам света, вода/лёд/лава — своими уровнями; geo — карта местности для контуров */
  float L0=.075,L1=.035,L2=.015,L3=.006, W0=.016,W1=.009,W2=.004;
  float lum, geo=0., hi=0.;
  if(kind==0){                                   // Islands: PlanetUnder (вода) + PlanetLandmass (суша)
    float W=mix(W0,W2,smoothstep(.25,.8,dl));      // вода ровная: пятна от шума принимались за облака
    vec3 b=uv*4.292; float f1=fbm(b,6),f2=fbm(b-Lo*f1,6),f3=fbm(b-Lo*1.5*f1,6),f4=fbm(b-Lo*2.*f1,6);
    lightWarp(dl,.32,.534,f2,f3,f4);
    float d2=pow(dl,2.)*.1; float Lc=L3; Lc=mix(Lc,L2,lt(f4+d2,f1)); Lc=mix(Lc,L1,lt(f3+d2,f1)); Lc=mix(Lc,L0,lt(f2+d2,f1));
    geo=lt(uCut,f1); lum=mix(W,Lc,geo);
  } else if(kind==1){                            // Terran Wet: LandRivers
    vec3 b=uv*4.6; float f1=fbm(b,6),f2=fbm(b-Lo*f1,6),f3=fbm(b-Lo*1.5*f1,6),f4=fbm(b-Lo*2.*f1,6);
    float rf=fbm(b+f1*6.,6);
    lightWarp(dls,.287,.476,f2,f3,f4);
    float d2=pow(dls,2.)*.4; float Lc=L3; Lc=mix(Lc,L2,lt(f4+d2,f1*1.5)); Lc=mix(Lc,L1,lt(f3+d2,f1)); Lc=mix(Lc,L0,lt(f2+d2,f1));
    geo=lt(rf,.368); lum=mix(Lc,mix(W1,W0,lt(f4+d2,f1*1.5)),geo);
  } else if(kind==2){                            // Terran Dry: полосы освещённости по шуму
    float f=fbm(uv*8.,3); float d=smoothstep(-.3,1.2,dls); d*=mix(.9,1.,smoothstep(.35,.375,d))*mix(.9,1.,smoothstep(.51,.54,d));
    float x=d*pow(f,.8)*3.5*4.; float w=fwidth(x)+1e-4; float post=min((floor(x)+smoothstep(1.-w,1.,fract(x)))/4.,1.);
    lum=mix(.08,.004,post);
    float g=f*5.; geo=(floor(g)+smoothstep(1.-fwidth(g),1.,fract(g)))*.25;   // уровни местности без учёта света
  } else if(kind==3){                            // Ice World: PlanetUnder (лёд) + Lakes
    float di=dl+fbm(uv*8.,2)*.3; float I=bands(di,.48,.632,.09,.04,.016);
    float lake=fbm(uv*10.,3); float d=pow(dl,2.)*.4; d-=d*lake;
    geo=lt(.55,lake); lum=mix(I,bands(d,.024,.047,W0,W1,W2),geo);
  } else {                                       // No atmosphere / Lava World: грунт + кратеры (+ лава)
    bool lava=kind==5; float gs=lava?10.:8.; int go=lava?3:4; float gb1=lava?.4:.615,gb2=lava?.6:.729;
    float g1=fbm(uv,go); float dg=dl+fbm(uv*gs+g1,go)*.3; float G=bands(dg,gb1,gb2,L0,L1,L2);
    float cs=lava?3.5:5.,cb=lava?.4:.465; vec3 q=uv*cs;
    float k1=crater(q),k2=crater(q+vec3((uLight-.5)*.03*cs,0.));
    float shadow=max(lt(k2,k1-(.5-dl)*2.),lt(cb,dl)), cm=lt(.5,k1);
    lum=mix(G,mix(G*.72,G*.4,shadow),cm); geo=cm;
    if(lava){ float f1=fbm(uv*10.,4); float rf=fbm(uv*2.+f1*2.5,4); float d=pow(dl,2.)*.4; d-=d*rf;
      float lm=lt(.579,rf); lum=mix(lum,bands(d,.019,.036,.2,.1,.04),lm); geo=max(geo,lm); hi=lm; }
  }
  float edge=clamp(fwidth(geo)*2.2,0.,1.);       // контуры местности: берега, озёра, реки, кратеры
  float lit=1.-smoothstep(.35,.75,dl);           // контур ярче на освещённой стороне
  lum+=edge*(.07+.3*lit);
  if(uCloud>0.){                                 // облака: отдельный слой — светлая косая штриховка с контуром, сквозь неё видно землю
    vec3 cq=(P*.5+uOff.zxy)*vec3(1.,2.,1.)*7.745;   // облака неподвижны: иначе штриховка «плывёт» по краям
    float cn=0.;for(int i=0;i<9;i++)cn+=cloudNoise(cq*.3+float(i+1)+10.);
    float cc=fbm(cq+cn,2);
    float cut=mix(.78,.36,uCloud),cm=lt(cut,cc);
    float cl=bands(dl+cc*.2,.52,.62,.16,.08,.03);
    float hatch=step(.55,fract((gl_FragCoord.x+gl_FragCoord.y)/5.));
    float ce=clamp(fwidth(cm)*2.2,0.,1.);
    lum=mix(lum,lum*.55+cl*(.35+.65*hatch),cm*.85)+ce*cl*1.6;
  }
  vec3 col=uInk*lum+uBg;
  if(uMarkOn>0.){                                // зона операции — прямо на поверхности, чёткими линиями ~1,5 px
    float dm=2.*asin(min(1.,length(P-uTarget)*.5)),fw=max(fwidth(dm),1e-6);   // asin точнее acos на малых углах
    vec3 up=abs(uTarget.y)<.99?vec3(0.,1.,0.):vec3(1.,0.,0.);
    vec3 t1=normalize(cross(up,uTarget)),t2=cross(uTarget,t1);
    float az=atan(dot(P,t2),dot(P,t1)),R=uZone;
    float ring=1.-smoothstep(.6,1.4,abs(dm-R)/fw);
    float inner=(1.-smoothstep(.4,1.1,abs(dm-R*.55)/fw))*step(.5,fract(az*24./6.2832));
    float dotc=1.-smoothstep(2.,3.,dm/fw);
    float ka=abs(fract(az/1.5708+.5)-.5)*1.5708;
    float tick=(1.-smoothstep(.5,1.3,dm*sin(ka)/fw))*step(R*1.12,dm)*step(dm,R*1.45)*uTicks;
    float ph=fract(uClock*.55),pr=R*(1.+ph*.7);
    float pulse=(1.-smoothstep(.4,1.1,abs(dm-pr)/fw))*(1.-ph)*.7;
    float fill=(1.-smoothstep(R-fw,R,dm))*.022;
    float m=max(max(ring,dotc),max(inner*.65,max(tick,pulse)));
    float lit2=.45+.55*(1.-smoothstep(.35,.85,dl));   // метка — часть поверхности: на теневой стороне тусклее
    col=mix(col,uHot*lit2,m*uMarkOn)+uHot*fill*lit2*uMarkOn;
  }
  gl_FragColor=vec4(col*uOp,1.);
  #include <colorspace_fragment>
}`;


function dirOf(lat, lon) { const la = lat * DEG, lo = lon * DEG; return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)); }
/* Точка света на диске планеты (как light_origin в PixelPlanets): угол 0° — справа, 90° — сверху; dist — от центра диска. */
function lightOrigin(l) { const a = ((l && l.angle) ?? 135) * DEG, d = (l && l.dist) ?? .28; return new THREE.Vector2(.5 + Math.cos(a) * d, .5 - Math.sin(a) * d); }

/* Сфера планеты. При align = 1 точка (lat, lon) смотрит на камеру; tilt — наклон оси в плоскости экрана. */
/* pal — цвета темы брифинга { ink, bg, hot } (themes.js); без неё — монохром. */
function create(pl, pal = {}) {
  const T = TYPES[pl.type] || TYPES.terran, R = rng(pl.seed * 97 + 3);
  const uni = { uInk:{ value:new THREE.Color(pal.ink || '#dfe2d8') }, uWater:{ value:new THREE.Color(T.water) }, uBg:{ value:new THREE.Color(pal.bg || '#090a0b') },
    uOff:{ value:new THREE.Vector3(R() * 20, R() * 20, R() * 20) }, uTarget:{ value:dirOf(pl.lat, pl.lon) }, uLight:{ value:lightOrigin(pl.light) },
    uKind:{ value:T.kind }, uSeed:{ value:1 + (Math.abs(pl.seed | 0) % 1000) / 100 }, uCut:{ value:T.cut ?? .633 }, uCloud:{ value:Math.max(0, Math.min(1, pl.clouds ?? T.clouds ?? 0)) },
    uOp:{ value:1 }, uMark:{ value:0 }, uDetail:{ value:0 }, uTime:{ value:0 },
    uZone:{ value:.03 }, uMarkOn:{ value:0 }, uTicks:{ value:0 }, uClock:{ value:0 }, uHot:{ value:new THREE.Color(pal.hot || '#ff5a2c') } };
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({ uniforms:uni, vertexShader:VS, fragmentShader:FS });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 100), mat); group.add(sphere);
  const outer = new THREE.Group(); outer.add(group);
  const target = dirOf(pl.lat, pl.lon);
  const qAlign = new THREE.Quaternion().setFromUnitVectors(target, new THREE.Vector3(0, 0, 1));
  const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -(pl.tilt || 0) * DEG);
  const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
  // луч из точки операции вверх по нормали и маркер-ромб на конце: объём, который вращается вместе с планетой
  const hot = new THREE.Color(pal.hot || '#ff5a2c'), bm = new THREE.LineBasicMaterial({ color:hot, transparent:true, opacity:.9 });
  const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]), bm);
  beam.position.copy(target); beam.quaternion.setFromUnitVectors(Y, target);
  const tip = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(1)), bm);
  const marker = new THREE.Group(); marker.add(beam, tip); marker.visible = false; group.add(marker);
  let beamH = .05;
  return {
    root:outer, group, uni, target, type:T,
    /* зона: on, угловой радиус R (рад, размер на самой планете), высота луча h, риски */
    setMarker(on, R = .03, h = .05, ticks = 0) { uni.uMarkOn.value = on ? 1 : 0; uni.uZone.value = R; uni.uTicks.value = ticks; marker.visible = !!on;
      beamH = h; beam.scale.set(1, h, 1); tip.position.copy(target).multiplyScalar(1 + h); tip.scale.setScalar(Math.max(.004, h * .09)); tip.quaternion.copy(beam.quaternion); },
    markerTop(v = new THREE.Vector3()) { return v.copy(target).multiplyScalar(1 + beamH).applyQuaternion(group.quaternion); },
    /* align 0..1: от свободного вращения к точке, развёрнутой на камеру; вращение — вокруг наклонённой оси */
    /* pitch — насколько точка уходит вверх от центра диска: камера видит район под углом, а не строго сверху */
    pose(t, align, extra = 0, pitch = 0) { const spin = new THREE.Quaternion().setFromAxisAngle(Y, -(1 - align) * (1.6 + t * .12) + extra);
      group.quaternion.setFromAxisAngle(X, -pitch).multiply(qTilt).multiply(spin).multiply(qAlign); uni.uTime.value = t; },
    markerWorld(v = new THREE.Vector3()) { return v.copy(target).multiplyScalar(1.01).applyQuaternion(group.quaternion); },
    /* центр зоны на экране и радиус в пикселях для углового радиуса R (рад) */
    zoneScreen(cam, w, h, R) { const up = Math.abs(target.y) < .99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), t1 = up.clone().cross(target).normalize();
      const c = target.clone().applyQuaternion(group.quaternion).project(cam), e = target.clone().multiplyScalar(Math.cos(R)).addScaledVector(t1, Math.sin(R)).applyQuaternion(group.quaternion).project(cam);
      const sx = (c.x * .5 + .5) * w, sy = (-c.y * .5 + .5) * h; return { sx, sy, r:Math.hypot((e.x * .5 + .5) * w - sx, (-e.y * .5 + .5) * h - sy) }; },
    dispose() { outer.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); }); },
  };
}

/* Маленькое окно предпросмотра для редактора (свой WebGL-контекст). */
function preview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#090a0b');
  const cam = new THREE.PerspectiveCamera(30, 1, .1, 20); cam.position.set(0, 0, 4.4);
  let P = null, raf = 0, t0 = performance.now(), align = 0, dragging = false, manual = 0, lastX = 0;
  canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (dragging) { manual += (e.clientX - lastX) * .01; lastX = e.clientX; } });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  function set(pl) { if (P) { scene.remove(P.root); P.dispose(); } P = pl ? create(pl) : null; if (P) { scene.add(P.root); P.setMarker(true, .06, .18); } }
  function loop() {
    raf = requestAnimationFrame(loop);
    const w = canvas.clientWidth, h = canvas.clientHeight; if (canvas.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    const t = (performance.now() - t0) / 1000;
    if (P) { align += ((dragging ? 0 : 1) - align) * .03; if (!dragging && align > .999) align = 1; P.pose(dragging ? t : 0, align, manual); }
    renderer.render(scene, cam);
    if (P) P.uni.uClock.value = t;
  }
  loop();
  return { set, dispose() { cancelAnimationFrame(raf); if (P) P.dispose(); renderer.dispose(); renderer.forceContextLoss(); } };
}

return { TYPES, generate, create, preview, dirOf, lightOrigin };
};
})();

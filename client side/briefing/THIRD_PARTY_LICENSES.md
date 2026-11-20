# Сторонний код

## PixelPlanets

Алгоритмы генерации поверхности планет в `planet.js` (слои суши, воды, рек, озёр, кратеров и лавы, освещение от точки на диске, наклон оси) перенесены из проекта PixelPlanets (Deep-Fold, https://deep-fold.itch.io/pixel-planet-generator). Использованы только алгоритмы генерации: пиксельная отрисовка, дизеринг и палитры оригинала не переносились.

```
MIT License

Copyright (c) 2020 Deep-Fold

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## three.js

Копия three.js r160 (`vendor/three`: сборка `three.module.js` и используемые дополнения — OrbitControls и постобработка) лежит в проекте, чтобы брифинг не зависел от CDN. https://threejs.org, лицензия MIT, полный текст — `vendor/three/LICENSE`.

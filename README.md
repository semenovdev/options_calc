# MOEX Options Workbench

Интерактивный калькулятор опционных стратегий на Vue 3 и TypeScript. Рыночные данные,
греки, P&L, гарантийное обеспечение, графики и улыбка волатильности загружаются из
MOEX Option Calc API и MOEX ISS.

## Возможности

- несколько локально сохраняемых стратегий;
- позиции в опционах, фьючерсах и акциях;
- P&L и профили Delta, Gamma, Vega, Theta и Rho;
- сценарий по дате и сдвигу волатильности;
- улыбка волатильности и оценка ликвидности;
- delta- и vega-экспозиция;
- экспорт стратегии в CSV и JSON.

## Запуск

Требуется Node.js 24.21.0.

```sh
npm install
npm run dev
```

Vite проксирует запросы `/moex-option-calc` и `/moex-iss` на `https://iss.moex.com`,
поэтому для production-развёртывания эти маршруты также должны быть настроены на reverse proxy.

## Проверки

```sh
npm run type-check
npm run lint
npm test
npm run build
```

Все зависимости имеют open-source лицензии. Сводка находится в
[`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md).

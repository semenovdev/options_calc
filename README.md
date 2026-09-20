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

Адрес Option Calc API задаётся в `.env`:

```sh
# Встроенный Vite proxy на оригинальный MOEX API (значение по умолчанию)
VITE_OPTION_CALC_BASE_URL=/moex-option-calc

# Локальный Rust backend
VITE_OPTION_CALC_BASE_URL=http://127.0.0.1:3000
```

После изменения `.env` перезапустите Vite. Завершающий `/` необязателен. При прямом
подключении по другому origin Rust backend должен разрешать origin фронтенда через CORS.
Vite продолжает проксировать `/moex-option-calc` на `https://iss.moex.com`; маршрут
`/moex-iss`, используемый для рыночных данных ISS, остаётся без изменений.

Для локального Rust backend без CORS используйте Vite proxy:

```sh
VITE_OPTION_CALC_BASE_URL=/moex-option-calc
VITE_OPTION_CALC_PROXY_TARGET=http://127.0.0.1:8080
```

## Проверки

```sh
npm run type-check
npm run lint
npm test
npm run test:e2e
npm run build
```

E2E-тесты используют Playwright Chromium и реальные API без подмены ответов. Опционные
стратегии создаются по расчётным ценам. `npm run test:e2e:moex` проверяет оригинальный
MOEX Option Calc, `npm run test:e2e:rust` запускает Rust backend и тот же набор сценариев,
а `npm run test:e2e` последовательно выполняет оба режима. Путь к backend можно изменить
через `E2E_RUST_BACKEND_DIR`. Для первого запуска установите браузер:
`npx playwright install chromium`.

Проверка каталога помечена `@catalog`: она перебирает зафиксированный снимок всех
базовых активов MOEX Option Calc и ищет их в интерфейсе. Серии и SECID опционов в
снимок намеренно не входят, поскольку они экспирируются. Тест можно
запускать отдельно командами `npm run test:e2e:catalog:moex` и
`npm run test:e2e:catalog:rust`. Более короткие миграционные прогоны без полного
каталога: `npm run test:e2e:core:moex` и `npm run test:e2e:core:rust`.

Все зависимости имеют open-source лицензии. Сводка находится в
[`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md).

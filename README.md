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
npm run build
```

Все зависимости имеют open-source лицензии. Сводка находится в
[`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md).

# Web crawler egress policy (TR-30)

Краулер ходит только в публичный HTTP(S). Проверка выполняется для стартового URL и **каждого** redirect.

## Правила

- scheme: только `http:` и `https:` (`file:`, `ftp:` и т.п. → `EGRESS_SCHEME`);
- URL с `user:pass@` → `EGRESS_CREDENTIALS`;
- `localhost`, `*.localhost`, `*.local`, `*.internal` → `EGRESS_PRIVATE`;
- частные/служебные IP (v4 и v6): `10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`,
  `100.64/10`, `198.18/15`, `0/8`, `224/4`, `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped → `EGRESS_PRIVATE`;
- DNS-имя резолвится, и **все** адреса проверяются; закрытый адрес → `EGRESS_PRIVATE`; ошибка DNS → `EGRESS_DNS`;
- опциональный `allowedHosts` — точный allowlist; чужой хост → `EGRESS_HOST`;
- redirect: `Location` резолвится и проверяется заново; больше `maxRedirects` (default 5) → `EGRESS_REDIRECT`;
- ответ — только 2xx; иначе `HTTP <status>`.

## Конфигурация

```json
{
  "web-crawler": {
    "maxPages": 100,
    "timeoutMs": 10000,
    "maxRedirects": 5,
    "allowedHosts": ["docs.example.com"],
    "allowPrivate": false
  }
}
```

`allowPrivate: true` **не** рекомендуется: это отключает проверку частных адресов (нужно только для локальных тестов).

## Ограничения

- DNS rebinding между проверкой и `fetch` не закрыт: проверка резолвит имя, fetch резолвит снова.
- Нет allowlist по портам/CIDR; `allowedHosts` — только точные имена.
- `crawlSite` по-прежнему ограничивает ссылки same-origin, но стартовый URL теперь тоже проверяется.
- Контент страницы не санитизируется от prompt injection (TR-01).

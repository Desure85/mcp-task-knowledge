# ADR-004: LAN Relay discovery — UDP multicast вместо mDNS-библиотеки

- **Статус:** Accepted (2026-08-29, BM-012)
- **Область:** src/relay/discovery.ts

## Контекст

BM-012 требовал zero-config обнаружение пиров в LAN. Классический путь —
mDNS (bonjour/multicast-dns), но это внешние зависимости. Философия проекта:
zero-dep, минимум зависимостей.

## Решение

UDP multicast через встроенный `node:dgram`:

- фиксированная группа `239.255.42.99:41234`
- heartbeat-датаграммы (JSON: name, port, ts) каждые 5с
- пиры прунятся по TTL (15с без heartbeat)
- данные не шифруются (presence-only), шифруется только WebSocket-канал

Единственная новая зависимость — `ws` (стандарт WebSocket, zero-dep).

## Последствия

- Плюс: zero-dep discovery, работает в любом LAN с multicast
- Минус: не пересекает VLAN/подсети (как и mDNS); отсутствие шифрования discovery-датаграмм (приемлемо: только метаданные)

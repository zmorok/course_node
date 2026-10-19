# Каркас backend Workify

Backend использует JavaScript, Express 5 и `pg`. Создание приложения не открывает порт и не создаёт глобальных соединений. Каркас этапа 04 расширен [авторизацией и ролями](auth.md), [профилем/навыками](profile.md) и [файлами/портфолио](files-and-portfolio.md); health API сохраняет прежний контракт.

## Структура и границы слоёв

```text
backend/src/
  app.js                       # Middleware и подключение API router
  server.js                    # Конфигурация, сборка зависимостей, HTTP и shutdown
  config/
    env.js                     # Проверка environment до запуска
    database.js                # Фабрика pg Pool
  routes/                      # URL, middleware и controller
  controllers/                 # HTTP -> вызов service -> HTTP
  services/                    # Правила и координация, без Express req/res
  repositories/                # SQL, преобразование строк и транзакции
  middleware/                  # Request ID, 404, ошибки и валидация
  validators/                  # Чистые парсеры объектов и полей
  utils/                       # AppError, ValidationError, asyncHandler
backend/test/
  unit/                        # Конфигурация, HTTP, валидация и ошибки ресурсов
  integration/                 # Реальный PostgreSQL и транзакции
```

| Слой | Ответственность | Зависимости |
|---|---|---|
| routes | Путь, порядок middleware и asyncHandler | Собирает controller; не исполняет SQL |
| controllers | Проверенные данные → service → HTTP-ответ | Service передаётся фабрике, доступа к БД нет |
| services | Решения и координация | Получает repository/адаптеры, не получает req/res и не пишет SQL |
| repositories/DAO | Параметризованные запросы и преобразование результата | Получает pool или транзакционный client; не решает права пользователя |
| middleware/validators | Общие HTTP-правила и проверка формы данных | Валидация не подменяет авторизацию или бизнес-проверки |

[server.js](../backend/src/server.js) создаёт config → pool → repositories → health/auth/profile services → apiRouter → app, затем начинает слушать порт. [createApp](../backend/src/app.js) собирает HTTP-приложение из переданного router. Фабрики позволяют тестировать запросы с подставными зависимостями; тестовые маршруты не подключены в рабочем server.js.

При SIGTERM/SIGINT HTTP server прекращает принимать новые запросы, затем закрывается pg pool. Повторный сигнал не запускает параллельное закрытие; предельное ожидание — 10 секунд. Ошибка конфигурации или запуска завершает процесс с ненулевым кодом, без печати credentials.

## Конфигурация и pool

[loadConfig](../backend/src/config/env.js) проверяет environment и возвращает неизменяемый объект. Числа допускают целую десятичную запись и заданный диапазон. Пустые host/user/database/password, неизвестный NODE_ENV и относительный UPLOAD_DIR отклоняются до открытия HTTP-порта. Пароль сохраняется точно, включая значимые пробелы; ConfigurationError перечисляет только имена ошибочных полей.

Docker передаёт PGHOST=postgres, PGPORT=5432, PGDATABASE/PGUSER/PGPASSWORD и UPLOAD_DIR=/app/uploads. PORT внутри контейнера — 3000, NODE_ENV — production. Дополнительные настройки:

| Environment | По умолчанию | Допустимый диапазон |
|---|---|---|
| HTTP_JSON_LIMIT_BYTES | 65536 | 1024–1048576 байт |
| PGPOOL_MAX | 5 | 1–50 соединений |
| PG_CONNECTION_TIMEOUT_MS | 2000 | 100–30000 мс |
| PG_IDLE_TIMEOUT_MS | 10000 | 1000–60000 мс |
| PG_QUERY_TIMEOUT_MS | 2000 | 100–60000 мс |
| PG_STATEMENT_TIMEOUT_MS | 2000 | 100–60000 мс |

Настройки передаются из .env через Compose; безопасные значения приведены в [.env.example](../.env.example). Необязательные отсутствующие параметры получают defaults Compose; AUTH_JWT_SECRET генерируется setup-env и обязателен. FRONTEND_PORT/BACKEND_PORT меняют host binding, не внутренние адреса сервисов. Параметры авторизации описаны [отдельно](auth.md#конфигурация-и-первый-admin).

[createDatabasePool](../backend/src/config/database.js) создаёт один pool на процесс. Импорт config/app/repository не создаёт pool или соединение. Idle connection errors обрабатываются без печати строки подключения. SQL остаётся в repositories; значения пользователя передаются через `$1`, `$2` и массив параметров.

## Порядок HTTP-обработки

1. Сгенерировать UUID запроса и установить `X-Request-Id`. Клиентский заголовок не используется как доверенный идентификатор.
2. Разобрать JSON / `application/*+json` с ограничением размера. Multipart разбирает Multer только на POST /files после авторизации; валидация содержимого и сохранение выполняются FileService и LocalStorage.
3. Выполнить маршрут и middleware, затем controller через [asyncHandler](../backend/src/utils/async-handler.js).
4. Неизвестный маршрут передать как NOT_FOUND; ошибки обработать единым middleware.

Query parser — simple. Middleware не присваивает значение Express getter `req.query`: проверенные данные лежат отдельно в `request.validated.body`, `.query` и `.params`. `X-Powered-By` выключен.

## Формат ошибок

Ошибки backend возвращают JSON, `Cache-Control: no-store` и совпадающий requestId в body/header:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Некорректные данные запроса",
    "details": [{"field": "body.title", "message": "Ожидается строка"}]
  },
  "requestId": "721c431d-0be8-4843-96ed-962e9a7ae89a"
}
```

| Ситуация | HTTP | code |
|---|---|---|
| Неизвестный маршрут | 404 | NOT_FOUND |
| Неверный JSON | 400 | INVALID_JSON |
| Неверное кодирование URL / повреждённый запрос | 400 | INVALID_REQUEST |
| Превышен лимит тела | 413 | PAYLOAD_TOO_LARGE |
| Неподдерживаемая кодировка тела | 415 | UNSUPPORTED_ENCODING |
| Ошибки полей, PostgreSQL NOT NULL/CHECK/неверный тип | 422 | VALIDATION_ERROR |
| PostgreSQL UNIQUE/FK, serialization/deadlock | 409 | CONFLICT |
| Недоступность соединения PostgreSQL | 503 | SERVICE_UNAVAILABLE |
| Непредвиденная ошибка | 500 | INTERNAL_ERROR |

[AppError/ValidationError](../backend/src/utils/app-error.js) предназначены для явно заданных публичных ошибок. Для непредвиденных исключений SQL, constraint/detail драйвера, stack, connection string и credentials не возвращаются. Для 5xx используется фиксированное безопасное сообщение даже при другом тексте AppError. Технический лог содержит requestId, code и status; тело, query string и заголовки не логируются. Аудит предметных действий относится к этапу 17.

asyncHandler передаёт в middleware синхронное исключение и rejected Promise. Не-Error rejection превращается в безопасный 500. Ошибка после отправки headers делегируется Express: повторный JSON уже отправить нельзя. Для callback API ошибка передаётся через next; фоновые Promise должны иметь собственную обработку.

`/api/health` сохраняет контракт readiness-отчёта `{status, checks}` с 200/503: это диагностический результат готовности. Исключения при выполнении маршрута проходят через общий error middleware. Контракт proxy при остановленном backend описан в [инфраструктуре](infrastructure.md).

## Валидация

[object.js](../backend/src/validators/object.js) собирает ошибки полей и отклоняет неуказанные поля, массив вместо объекта, унаследованный объект и специальные ключи прототипа. Результат строится отдельно; исходные данные не меняются. Ошибки содержат путь и сообщение без введённого значения.

[fields.js](../backend/src/validators/fields.js) предоставляет text с длиной/регулярным выражением, integer с границами и явным coerce, uuid, oneOf и optional с default. Строки по умолчанию обрезаются по краям; для паролей/токенов используется `trim: false`. Optional считает отсутствующим только undefined; null не обходит тип. Повторные query-параметры дают массив и не превращаются молча в одно число.

Будущий маршрут объявляет whitelist полей и использует [validate](../backend/src/middleware/validate.js) до controller. В service передаются только `request.validated[source]` и отдельно проверенная личность. Права, владение и статус проверяются service; клиент не задаёт их произвольно. Схемы регистрации и других предметных команд на этапе 04 не создаются.

## Транзакции

[withTransaction](../backend/src/repositories/transaction.js) берёт один client, выполняет BEGIN, передаёт тот же client в async operation, затем COMMIT либо ROLLBACK и ровно один release. Ошибка BEGIN не запускает operation. Ошибка rollback сохраняет исходную ошибку, а неисправный client освобождается с ошибкой для исключения из pool.

Границу транзакции задаёт будущий бизнес-сервис; SQL управления транзакцией находится в DAO helper. Все repositories операции используют переданный client, а не самостоятельный pool.query. Неявных вложенных транзакций и автоматических повторов нет: стратегия повторения требует правил конкретной команды и побочных эффектов.

## Проверки и исходные материалы

```powershell
node scripts/test-infrastructure.mjs
```

Runner монтирует тесты read-only в отдельные контейнеры и запускает 54 unit-проверки backend, 33 проверки на реальном PostgreSQL 17 и 6 тестов API-клиента, затем проверяет React/API, volumes и восстановление сервисов. Интеграционный набор требует WORKIFY_DB_TESTS=1, задаваемый этим запуском. Собственные тестовые строки удаляются набором, тестовые volumes — в finally. Рабочая база не используется.

Unit-набор отдельно после сборки backend:

```powershell
docker compose run --rm --no-deps --volume ./backend/test:/app/test:ro backend npm test
```

Unit-проверки не выполняют SQL: используются подставные repositories/HTTP-приложения. Проверяются конфигурация и отказ до listen, parser/404/5xx, request ID, скрытие деталей, whitelist и типы, readiness, commit/rollback и освобождение клиентов. Интеграционный набор проверяет pg pool, единую сессию, параметризацию, commit, rollback и восстановление после ошибки ограничения. В runtime image тестов нет.

На этапе 05 добавлены auth routes/controller/service/repository, middleware авторизации и ролей, Argon2id/JWT и миграция сессий. Состав проверок и конфигурация auth приведены в [документации авторизации](auth.md).

Изучены ООП `DAL/UnitOfWork.cs`, `FreelanceApp/Services/DbContextFactory.cs`, `DAL/Repository/UserRepositories/UserOrdersRepository.cs` и `_материалы/Workify_STSR_Project_Specification_v4/docs/07_backend_architecture.md`, `12_security.md`. Корни источников приведены в [предметной модели](domain-model.md). Сохранены repository и единая транзакционная сессия; EF, WPF, fallback-пользователь и выбор привилегированной DB-роли по данным клиента не переносятся. Роли CLIENT/ADMIN проверяются backend начиная с этапа 05.

Первичные источники: [Express error handling](https://expressjs.com/en/guide/error-handling/), [node-postgres transactions](https://node-postgres.com/features/transactions), [pg Pool API](https://node-postgres.com/apis/pool).

import { test, expect } from '@playwright/test';

const stamp = '2026-10-20T10:00:00Z';
const person = { id: 'client-a', role: 'CLIENT', firstName: 'Анна', lastName: 'Морозова', username: 'anna', email: 'anna@example.invalid', headline: 'Frontend-разработчик · React и TypeScript', description: 'Создаю понятные интерфейсы для сервисов и команд. Работаю с адаптивной вёрсткой, доступностью и интеграцией API.', city: 'Минск', country: 'Беларусь', skills: [{ id: 'react', name: 'React', slug: 'react' }, { id: 'ts', name: 'TypeScript', slug: 'typescript' }], avatarFileId: null, customerRating: 4.8, customerReviewCount: 8, freelancerRating: 4.9, freelancerReviewCount: 12 };
const freelancer = { ...person, id: 'freelancer-b', firstName: 'Денис', lastName: 'Соколов', username: 'denis', email: 'denis@example.invalid' };
const document = { id: 'document', originalName: 'Техническое-задание-с-подробным-описанием-требований.pdf', sizeBytes: 425000, mimeType: 'application/pdf', inUse: false };
const image = { id: 'image', originalName: 'interface-preview.png', sizeBytes: 123456, mimeType: 'image/png' };
const project = { id: 'project-a', title: 'Интерфейс образовательного сервиса', description: 'Нужен адаптивный личный кабинет: каталог курсов, прогресс обучения и профиль. Макеты и API предоставим.', status: 'OPEN', category: { id: 'web', slug: 'web', name: 'Веб-разработка' }, skills: person.skills, files: [document], isOwn: false, budget: 1800, desiredDeadlineAt: '2026-11-30T12:00:00Z', createdAt: stamp, customer: person };
const portfolio = [{ id: 'work-a', title: 'Личный кабинет образовательного сервиса', description: 'Каталог курсов и прогресс обучения.', experience: 'Проектирование и разработка интерфейса', skills: ['React'], links: ['https://example.invalid/work'], files: [image, document], createdAt: stamp, updatedAt: stamp }, { id: 'work-b', title: 'Исследование интерфейса', description: 'Описание исследования в PDF, без изображения.', experience: '', skills: [], links: [], files: [document], createdAt: stamp, updatedAt: stamp }];
const list = (items = [], extra = {}) => ({ items, total: items.length, page: 1, pageSize: 20, ...extra });
const modes = [{ theme: 'light', language: 'ru' }, { theme: 'dark', language: 'en' }];

async function fixture(page, { role = 'CLIENT', mode = 'freelancer', authenticated = true, orderStatus = 'IN_PROGRESS' } = {}) {
  const user = { ...person, role }, errors = [], commands = [], unknown = [];
  let session = authenticated;
  const initialSubmission = ['SUBMITTED', 'REVISION_REQUESTED', 'COMPLETED'].includes(orderStatus) ? { id: 'version-a', version: 1, status: orderStatus === 'COMPLETED' ? 'ACCEPTED' : orderStatus, comment: 'Готовая адаптивная версия', links: ['https://example.invalid/result'], files: [document], createdAt: stamp } : null;
  let order = { id: 'order-a', title: project.title, description: project.description, status: orderStatus, participantMode: mode, agreedPrice: 1800, deadlineAt: project.desiredDeadlineAt, initialDeadlineAt: project.desiredDeadlineAt, createdAt: stamp, updatedAt: stamp, customer: mode === 'customer' ? person : freelancer, freelancer: mode === 'freelancer' ? person : freelancer, project, source: { type: 'proposal' }, files: [document], lastSubmission: initialSubmission, pendingDeadlineRequest: null, isOverdue: false, permissions: { submit: mode === 'freelancer' && ['IN_PROGRESS', 'REVISION_REQUESTED'].includes(orderStatus), requestDeadline: mode === 'freelancer' && orderStatus === 'IN_PROGRESS', cancel: ['IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED'].includes(orderStatus), approveDeadline: false, acceptSubmission: mode === 'customer' && orderStatus === 'SUBMITTED' } };
  let submissions = initialSubmission ? [initialSubmission] : [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace(/^\/api/, '');
    const method = req.method();
    if (method !== 'GET') commands.push({ path, method, body: req.postData() });
    if (path.startsWith('/files/') && method === 'GET') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#E4F1EB"/><rect x="40" y="40" width="560" height="280" rx="12" fill="#174B42"/><rect x="64" y="64" width="150" height="24" rx="8" fill="#8BD6B7"/></svg>' });
    let data;
    if (path === '/auth/refresh') return route.fulfill({ status: session ? 200 : 401, json: session ? { user, accessToken: 'test-token' } : { error: { code: 'UNAUTHENTICATED', message: 'Войдите в аккаунт' } } });
    if (path === '/auth/login') { session = true; data = { user, accessToken: 'test-token' }; }
    else if (path === '/auth/logout') { session = false; data = {}; }
    else if (path === '/admin/access') data = { allowed: true };
    else if (path === '/auth/me') data = { user };
    else if (path === '/health') data = { status: 'ok' };
    else if (path === '/categories') data = { categories: [project.category] };
    else if (path === '/skills') data = { skills: person.skills };
    else if (path === '/files') data = { files: [document] };
    else if (path === '/me/notifications/unread') data = { unreadCount: 3 };
    else if (path === '/me/notifications') data = list([{ id: 'notice-a', type: 'ORDER_CREATED', message: 'Создан заказ: Интерфейс образовательного сервиса', readAt: null, createdAt: stamp, href: '/orders/order-a' }], { unreadCount: 3 });
    else if (path === '/me/profile') data = { profile: user };
    else if (path === '/me/portfolio' || /^\/users\/[^/]+\/portfolio$/.test(path)) data = { items: portfolio };
    else if (path === '/users/freelancer-b') data = { profile: freelancer };
    else if (/^\/users\/[^/]+\/reviews$/.test(path)) data = list([], { rating: null });
    else if (path === '/freelancers') data = list([freelancer]);
    else if (/^\/freelancers\/[^/]+\/projects$/.test(path)) data = { projects: [project] };
    else if (path === '/projects' || path === '/me/projects') data = list([{ ...project, isOwn: path === '/me/projects' }]);
    else if (path === '/projects/project-a') data = { project };
    else if (/^\/projects\/[^/]+\/(proposals|invitations)$/.test(path)) data = list();
    else if (path === '/me/orders') data = list([order]);
    else if (path === '/orders/order-a') data = { order };
    else if (path === '/orders/order-a/submissions' && method === 'POST') {
      const body = req.postDataJSON();
      const submission = { id: 'version-a', version: 1, status: 'SUBMITTED', createdAt: stamp, files: [], ...body };
      submissions = [submission];order = { ...order, status: 'SUBMITTED', lastSubmission: submission, permissions: { ...order.permissions, submit: false, requestDeadline: false } };data = { submission };
    }
    else if (path === '/orders/order-a/submissions') data = list(submissions);
    else if (path === '/orders/order-a/submissions/version-a/accept' && method === 'POST') {
      submissions = submissions.map(item => ({ ...item, status: 'ACCEPTED', reviewedAt: stamp, reviewComment: req.postDataJSON().comment ?? '' }));
      order = { ...order, status: 'COMPLETED', lastSubmission: submissions[0], completedAt: stamp, permissions: { submit: false, requestDeadline: false, cancel: false, approveDeadline: false, acceptSubmission: false } };data = { order };
    }
    else if (path === '/orders/order-a/deadline-requests' || path === '/orders/order-a/events') data = list();
    else if (path === '/orders/order-a/reviews') data = { items: [], canReview: false, ownReview: null };
    else if (path === '/orders/order-a/complaints') data = { complaint: null, canCreate: false };
    else if (path === '/me/reviews') data = list([], { rating: null });
    else if (['/me/proposals', '/me/invitations', '/me/complaints', '/me/warnings', '/admin/complaints', '/admin/audit/imported'].includes(path)) data = list();
    else if (path === '/admin/users') data = list([person, { ...freelancer, status: 'BLOCKED' }]);
    else if (path === '/admin/users/freelancer-b') data = { user: { ...freelancer, status: 'BLOCKED', createdAt: stamp, blockedAt: stamp, blockReason: 'Подтверждённое нарушение условий работы. '.repeat(3) } };
    else if (path === '/admin/users/freelancer-b/sanctions') data = list([{ id: 'sanction-a', action_type: 'WARNING', reason: 'Предыдущее предупреждение', created_at: stamp, first_name: 'Администратор', last_name: 'Workify', current: false }]);
    else if (path === '/admin/complaints/complaint-a') data = { complaint: { id: 'complaint-a', reason: 'Нарушение согласованных условий', description: project.description, status: 'IN_REVIEW', createdAt: stamp, assignedAdminId: user.id, reporterId: person.id, targetId: freelancer.id, files: [document] }, permissions: { claim: false, resolve: true }, customer: person, freelancer, order: { ...order, price: order.agreedPrice, source: { type: 'proposal', message: 'Согласованное предложение', price: 1800, offered_deadline_at: project.desiredDeadlineAt, decided_at: stamp } }, project };
    else if (/^\/admin\/complaints\/complaint-a\/(submissions|deadline-requests|events|reviews)$/.test(path)) data = list();
    else if (path === '/admin/audit') data = list([{ id: 'event-a', action: 'PROJECT_UPDATED', entityType: 'project', entityId: 'project-a', createdAt: stamp, actor: person, metadata: { title: project.title, details: 'long-content-'.repeat(30) }, oldData: null, newData: { title: project.title } }]);
    else { unknown.push(path); return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Не найдено' } } }); }
    return route.fulfill({ json: data });
  });
  return { errors, commands, unknown };
}
async function noOverflow(page) {
  const result = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, main: document.querySelector('main').scrollWidth, mainWidth: document.querySelector('main').clientWidth }));
  expect(result.page, JSON.stringify(result)).toBeLessThanOrEqual(result.viewport + 1);
  expect(result.main, JSON.stringify(result)).toBeLessThanOrEqual(result.mainWidth + 1);
}

for (const width of [1440, 768, 390, 320]) {
  test(`Workify client screens fit ${width}px in RU/light and EN/dark`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 960 });
    const app = await fixture(page);
    for (const preferences of modes) {
      await page.goto('/projects');
      await page.locator('#interface-language').selectOption(preferences.language);
      if (await page.locator('html').getAttribute('data-theme') !== preferences.theme) await page.getByRole('button', { name: /Тёмная тема|Светлая тема|Dark theme|Light theme/ }).click();
      for (const path of ['/projects', '/freelancers', '/users/freelancer-b', '/projects/project-a', '/projects/new', '/me/projects', '/me/proposals', '/me/invitations', '/me/orders', '/orders/order-a', '/me/reviews', '/me/complaints', '/me/notifications', '/me/warnings', '/me/profile', '/']) {
        await page.goto(path);
        await expect(page.locator('main h1').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('alert')).toHaveCount(0);
        await noOverflow(page);
        if (['/projects', '/users/freelancer-b', '/orders/order-a'].includes(path)) await page.screenshot({ path: `../runtime/design-review/${width}-${preferences.theme}-${path.replaceAll('/', '-')}.png`, fullPage: true });
        if (path === '/me/profile') {
          for (const tab of ['security', 'portfolio']) {
            const name = tab === 'security' ? /Безопасность|Security/ : /Портфолио|Portfolio/;
            await page.locator('.profile-tabs').getByRole('button', { name }).click();
            await noOverflow(page);
          }
        }
      }
    }
    expect(app.errors).toEqual([]);expect(app.unknown).toEqual([]);
  });

  test(`Workify admin screens fit ${width}px in both themes`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 960 });
    const app = await fixture(page, { role: 'ADMIN' });
    for (const preferences of modes) {
      await page.goto('/admin/users');
      await page.locator('#interface-language').selectOption(preferences.language);
      if (await page.locator('html').getAttribute('data-theme') !== preferences.theme) await page.getByRole('button', { name: /Тёмная тема|Светлая тема|Dark theme|Light theme/ }).click();
      for (const path of ['/admin/users', '/admin/users/new', '/admin/complaints', '/admin/audit']) {
        await page.goto(path);await page.waitForLoadState('networkidle');
        await expect(page.locator('main h1').first()).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
        if (path === '/admin/audit') await page.getByText(preferences.language === 'ru' ? 'Данные события' : 'Event data', { exact: true }).click();
        await noOverflow(page);
      }
    }
    expect(app.errors).toEqual([]);expect(app.unknown).toEqual([]);
  });
}

test('mobile navigation closes on route change and Escape; filters keep values across theme changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto('/projects');
  await page.locator('.mobile-navigation summary').click();
  await expect(page.getByRole('navigation', { name: 'Мобильная навигация' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mobile-navigation')).not.toHaveAttribute('open');
  await page.locator('.mobile-navigation summary').click();
  await page.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('link', { name: 'Мои проекты', exact: true }).click();
  await expect(page).toHaveURL(/\/me\/projects$/);
  await expect(page.locator('.mobile-navigation')).not.toHaveAttribute('open');
  await page.locator('.filter-toggle').click();
  await page.locator('#filter-minBudget').fill('500');
  await page.getByRole('button', { name: 'Тёмная тема', exact: true }).click();
  await expect(page.locator('#filter-minBudget')).toHaveValue('500');
  await noOverflow(page);
});

test('order actions follow participation permissions and submit real form values', async ({ page }) => {
  const app = await fixture(page);
  await page.goto('/orders/order-a');
  await page.getByRole('button', { name: 'Сдать результат ↗', exact: true }).click();
  await page.locator('#submission-comment').fill('Готовая адаптивная версия');
  await page.locator('#submission-links').fill('https://example.invalid/result');
  await page.getByRole('button', { name: 'Передать на проверку', exact: true }).click();
  await expect(page.locator('.order-lead .status-submitted').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сдать результат ↗', exact: true })).toHaveCount(0);
  expect(app.commands.find(command => command.path === '/orders/order-a/submissions' && command.method === 'POST')).toMatchObject({ body: expect.stringContaining('Готовая адаптивная версия') });
  expect(app.errors).toEqual([]);expect(app.unknown).toEqual([]);
});

test('customer does not receive freelancer-only actions', async ({ page }) => {
  await fixture(page, { mode: 'customer' });
  await page.goto('/orders/order-a');
  await expect(page.locator('.order-lead')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сдать результат ↗', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Предложить новый срок', exact: true })).toHaveCount(0);
});

test('portfolio uses uploaded image attachments and leaves PDF-only work without an invented cover', async ({ page }) => {
  await fixture(page);
  await page.goto('/users/freelancer-b');
  await expect(page.locator('.portfolio-item')).toHaveCount(2);
  await expect(page.locator('.portfolio-item').first().locator('.portfolio-cover')).toHaveAttribute('src', '/api/files/image');
  await expect(page.locator('.portfolio-item').nth(1).locator('.portfolio-cover')).toHaveCount(0);
});

test('role navigation and direct access preserve administrator boundaries', async ({ page }) => {
  await fixture(page);
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Доступ только администратору' })).toBeVisible();
  await expect(page.locator('.workspace-sidebar a[href="/admin/users"]')).toHaveCount(0);
});

test('guest signs in from a project and returns to that project', async ({ page }) => {
  await fixture(page, { authenticated: false });
  await page.goto('/projects/project-a');
  await page.getByRole('link', { name: 'Войти или зарегистрироваться ↗', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('anna@example.invalid');
  await page.getByLabel('Пароль', { exact: true }).fill('Test-password-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/project-a$/);
  await expect(page.getByRole('heading', { name: project.title, exact: true })).toBeVisible();
});

test('sign-in ignores external return destinations', async ({ page }) => {
  await fixture(page, { authenticated: false });
  await page.goto('/?returnTo=%2F%2Fexample.invalid');
  await page.getByLabel('Email', { exact: true }).fill('anna@example.invalid');
  await page.getByLabel('Пароль', { exact: true }).fill('Test-password-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.locator('.account-card')).toBeVisible();
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
});

test('registration retains filled fields at 320px through language and theme changes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const app = await fixture(page, { authenticated: false });
  await page.goto('/');
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Анна');
  await page.getByLabel('Пароль', { exact: true }).fill('Test-password-123');
  await noOverflow(page);
  await page.locator('#interface-language').selectOption('en');
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await noOverflow(page);
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Анна');
  expect(app.errors).toEqual([]);
});

test('invitation disclosure keeps the profile compact and opens the existing form on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await fixture(page);
  await page.goto('/users/freelancer-b');
  await expect(page.locator('.proposal-form')).toHaveCount(0);
  await page.getByRole('button', { name: 'Пригласить в проект', exact: true }).click();
  await expect(page.locator('.proposal-form')).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.proposal-form')).toHaveCount(0);
});

test('mobile order follows the agreed block order and focuses the requested form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto('/orders/order-a');
  const selectors = ['.order-lead', '.order-summary', '.order-brief', '[aria-labelledby="submissions-heading"]'];
  const blocks = await Promise.all(selectors.map(selector => page.locator(selector).boundingBox()));
  for (let index = 1; index < blocks.length; index++) expect(blocks[index].y).toBeGreaterThan(blocks[index - 1].y);
  const domOrder = await page.locator('.order-detail-layout > *').evaluateAll(nodes => nodes.map(node => node.className));
  expect(domOrder[1]).toContain('order-summary');
  await page.getByRole('button', { name: 'Сдать результат ↗', exact: true }).click();
  await expect(page.locator('#submission-comment')).toBeFocused();
  await page.getByRole('button', { name: 'Отменить сдачу', exact: true }).click();
  await page.getByRole('button', { name: 'Предложить новый срок', exact: true }).click();
  await expect(page.locator('#order-new-deadline')).toBeFocused();
  await noOverflow(page);
  await page.screenshot({ path: '../runtime/design-review/390-light-order-deadline-form.png', fullPage: false });
});

test('customer accepts a submitted version through the existing confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const app = await fixture(page, { mode: 'customer', orderStatus: 'SUBMITTED' });
  await page.goto('/orders/order-a');
  await page.getByRole('link', { name: 'Проверить результат', exact: true }).click();
  await page.getByRole('button', { name: 'Принять результат', exact: true }).click();
  await page.locator('#submission-review').fill('Принимаю работу');
  await noOverflow(page);
  await page.getByRole('button', { name: 'Подтвердить приёмку', exact: true }).click();
  await expect(page.locator('.order-lead .status-completed')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Проверить результат', exact: true })).toHaveCount(0);
  expect(app.commands.some(command => command.path.endsWith('/version-a/accept') && command.method === 'POST')).toBe(true);
  expect(app.errors).toEqual([]);expect(app.unknown).toEqual([]);
});

test('administrator detail and sanction forms fit 320px in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const app = await fixture(page, { role: 'ADMIN' });
  await page.goto('/admin/users/freelancer-b');
  await expect(page.getByRole('heading', { name: 'Карточка пользователя' })).toBeVisible();
  await page.getByRole('button', { name: 'Изменить данные и роль', exact: true }).click();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Применить меру', exact: true }).click();
  await noOverflow(page);
  await page.goto('/admin/complaints/complaint-a');
  await page.getByRole('button', { name: 'Подтвердить нарушение', exact: true }).click();
  await page.locator('#resolution-note').fill('Обоснование решения администратора');
  await noOverflow(page);
  await page.getByRole('button', { name: 'Тёмная тема', exact: true }).click();
  await noOverflow(page);
  await page.screenshot({ path: '../runtime/design-review/320-dark-admin-complaint-decision.png', fullPage: true });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(app.errors).toEqual([]);expect(app.unknown).toEqual([]);
});

test('account screen keeps its workspace layout, refresh and sign-out behavior', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await fixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Аккаунт Workify', exact: true })).toBeVisible();
  await expect(page.locator('.intro')).toHaveCount(0);
  await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
  await expect(page.getByText('Данные аккаунта обновлены', { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: '../runtime/design-review/390-light-account.png', fullPage: true });
  await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  expect(app.commands.some(command => command.path === '/auth/logout' && command.method === 'POST')).toBe(true);
  expect(app.errors).toEqual([]);expect(app.unknown).toEqual([]);
});

import { test, expect } from '@playwright/test';

const client = { id: 'client-a', role: 'CLIENT', firstName: 'Анна', lastName: 'Тестовая', username: 'anna', email: 'anna@example.invalid' };
const project = (id) => ({
  id, title: `Project ${id}`, description: 'A project for browser navigation checks.', status: 'OPEN',
  category: { id: 'category-a', name: 'Веб-разработка' }, skills: [], files: [], isOwn: false,
  budget: 100, desiredDeadlineAt: null, createdAt: '2026-10-20T10:00:00Z', customer: client,
});

async function workspace(page, { authenticated = false } = {}) {
  const documents = [], refreshes = [], errors = [];
  let created;
  let complaint = { id: 'complaint-a', reason: 'Original complaint', description: 'Complaint details', status: 'NEW', participantMode: 'customer', createdAt: '2026-10-20T10:00:00Z', target: client, files: [], order: { id: 'order-a', title: 'Test order' }, canEdit: true };
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    let data;
    if (path === '/api/auth/refresh') {
      refreshes.push(path);
      return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { user: client, accessToken: 'test-token' } : { error: { code: 'UNAUTHENTICATED', message: 'Войдите в аккаунт' } } });
    }
    if (path === '/api/me/complaints/complaint-a') {
      if (route.request().method() === 'DELETE') { complaint = null; data = {}; }
      else if (route.request().method() === 'PUT') { complaint = { ...complaint, ...route.request().postDataJSON() }; data = { complaint }; }
      else data = { complaint };
    }
    else if (path === '/api/me/complaints') data = { items: complaint ? [complaint] : [], total: complaint ? 1 : 0, page: 1, pageSize: 20 };
    else if (path === '/api/auth/logout') { authenticated = false; data = {}; }
    else if (path === '/api/me/password') data = {};
    else if (path === '/api/me/profile') data = { profile: { ...client, skills: [], customerRating: null, freelancerRating: null } };
    else if (path === '/api/me/portfolio') data = { items: [] };
    else if (path === '/api/files') data = { files: [] };
    else if (path === '/api/health') data = { status: 'ok' };
    else if (path === '/api/me/notifications/unread') data = { unreadCount: 0 };
    else if (path === '/api/categories') data = { categories: [{ id: 'category-a', name: 'Веб-разработка' }] };
    else if (path === '/api/skills') data = { skills: [] };
    else if (path === '/api/projects' && route.request().method() === 'POST') {
      created = { ...project('c'), ...route.request().postDataJSON(), isOwn: true, status: 'DRAFT' };
      data = { project: created };
    }
    else if (path === '/api/projects/c') {
      if (route.request().method() === 'DELETE') { created = null; data = {}; }
      else data = { project: created };
    }
    else if (path === '/api/projects') data = { items: [project('a'), project('b')], total: 4, page: Number(url.searchParams.get('page') ?? 1), pageSize: 2 };
    else if (/^\/api\/projects\/[ab]$/.test(path)) data = { project: project(path.at(-1)) };
    else if (['/api/freelancers', '/api/me/orders', '/api/me/projects'].includes(path) || /^\/api\/projects\/c\/(proposals|invitations)$/.test(path)) data = { items: [], total: 0, page: 1, pageSize: 20 };
    else return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Не найдено' } } });
    return route.fulfill({ json: data });
  });
  return { documents, refreshes, errors };
}

test('catalog, filters, pagination and browser history keep the same document', async ({ page }) => {
  const app = await workspace(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled();
  const refreshCount = app.refreshes.length;
  await page.getByRole('navigation', { name: 'Навигация', exact: true }).getByRole('link', { name: 'Каталог проектов' }).click();
  await expect(page.getByRole('heading', { name: 'Каталог проектов', exact: true })).toBeVisible();
  await page.locator('#filter-search').fill('React');
  await page.getByRole('button', { name: /Применить фильтры/ }).click();
  await expect(page).toHaveURL(/search=React/);
  await page.getByRole('link', { name: 'Далее →', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.goBack();
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.locator('#filter-search')).toHaveValue('React');
  await page.goForward();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('#filter-search')).toHaveValue('React');
  await page.getByRole('navigation', { name: 'Навигация', exact: true }).getByRole('link', { name: 'Исполнители' }).click();
  await expect(page.getByRole('heading', { name: 'Найти исполнителя', exact: true })).toBeVisible();
  expect(app.documents).toHaveLength(1);
  expect(app.refreshes).toHaveLength(refreshCount);
  expect(app.errors).toEqual([]);
});

test('switching order modes and sections preserves the authenticated workspace', async ({ page }) => {
  const app = await workspace(page, { authenticated: true });
  await page.goto('/me/orders');
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  const refreshCount = app.refreshes.length;
  await page.getByRole('link', { name: 'Как исполнитель', exact: true }).click();
  await expect(page).toHaveURL(/mode=freelancer/);
  await page.getByRole('link', { name: 'История', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'История пока пуста' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('link', { name: 'Активные', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('navigation', { name: 'Навигация', exact: true }).getByRole('link', { name: 'Каталог', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Каталог проектов', exact: true })).toBeVisible();
  expect(app.documents).toHaveLength(1);
  expect(app.refreshes).toHaveLength(refreshCount);
  expect(app.errors).toEqual([]);
});

test('different detail IDs and direct deep links open the corresponding project', async ({ page }) => {
  const app = await workspace(page);
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Project a', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project a', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← К проектам', exact: true }).click();
  await page.getByRole('link', { name: 'Project b', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project b', exact: true })).toBeVisible();
  expect(app.documents).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Project b', exact: true })).toBeVisible();
  expect(app.documents).toHaveLength(2);
  expect(app.errors).toEqual([]);
});

test('language and theme switches preserve registration fields and translate field labels', async ({ page }) => {
  const app = await workspace(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Анна');
  await page.getByLabel('Фамилия', { exact: true }).fill('Тестовая');
  await page.getByLabel('Email', { exact: true }).fill('anna@example.invalid');
  await page.getByLabel('Пароль', { exact: true }).fill('A-test-password-123');
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.locator('#interface-language').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Create account', exact: true })).toBeVisible();
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Анна');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('A-test-password-123');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#interface-language').selectOption('ru');
  await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Анна');
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveValue('A-test-password-123');
  expect(app.documents).toHaveLength(1);
  expect(requests).toEqual([]);
  expect(app.errors).toEqual([]);
});

test('saving and deleting a project change the route without loading a document', async ({ page }) => {
  const app = await workspace(page, { authenticated: true });
  await page.goto('/projects/new');
  await page.locator('#project-title').fill('New SPA project');
  await page.locator('#project-description').fill('A draft that survives a language switch.');
  await page.locator('#project-category').selectOption('category-a');
  await page.locator('#interface-language').selectOption('en');
  await expect(page.locator('#project-title')).toHaveValue('New SPA project');
  await page.locator('#interface-language').selectOption('ru');
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/c$/);
  await expect(page.getByRole('heading', { name: 'New SPA project', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить черновик', exact: true }).click();
  await page.getByRole('button', { name: 'Да, удалить черновик', exact: true }).click();
  await expect(page).toHaveURL(/\/me\/projects$/);
  await expect(page.getByRole('heading', { name: 'Мои проекты', exact: true })).toBeVisible();
  expect(app.documents).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

test('password changes end the session and show the login notice without loading a document', async ({ page }) => {
  const app = await workspace(page, { authenticated: true });
  await page.goto('/me/profile');
  await page.locator('#password-currentPassword').fill('Current-password-123');
  await page.locator('#password-newPassword').fill('Another-password-456');
  await page.locator('#password-repeat').fill('Another-password-456');
  await page.getByRole('button', { name: 'Изменить пароль', exact: true }).click();
  await expect(page).toHaveURL(/\/\?passwordChanged=1$/);
  await expect(page.getByText('Пароль изменён. Войдите с новым паролем.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled();
  expect(app.documents).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

test('language switches preserve filters and update status dictionaries on the same page', async ({ page }) => {
  const app = await workspace(page);
  await page.goto('/projects?search=React');
  await expect(page.locator('#filter-search')).toHaveValue('React');
  await expect(page.locator('.project-card .status-open').first()).toHaveText('Открыт');
  await page.locator('#filter-search').fill('Unsubmitted filter');
  await page.locator('#interface-language').selectOption('en');
  await expect(page.locator('.project-card .status-open').first()).toHaveText('Open');
  await expect(page.locator('#filter-search')).toHaveValue('Unsubmitted filter');
  await page.locator('#interface-language').selectOption('ru');
  await expect(page.locator('.project-card .status-open').first()).toHaveText('Открыт');
  await expect(page.locator('#filter-search')).toHaveValue('Unsubmitted filter');
  await expect(page).toHaveURL(/search=React/);
  expect(app.documents).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

test('existing form validation messages translate without losing the input', async ({ page }) => {
  const app = await workspace(page, { authenticated: true });
  await page.goto('/me/profile');
  await page.locator('#password-currentPassword').fill('Current-password-123');
  await page.locator('#password-newPassword').fill('Another-password-456');
  await page.locator('#password-repeat').fill('Different-password-789');
  await page.getByRole('button', { name: 'Изменить пароль', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Новые пароли не совпадают');
  await page.locator('#interface-language').selectOption('en');
  await expect(page.getByRole('alert')).not.toContainText(/[А-Яа-яЁё]/);
  await expect(page.locator('#password-newPassword')).toHaveValue('Another-password-456');
  await page.locator('#interface-language').selectOption('ru');
  await expect(page.getByRole('alert')).toHaveText('Новые пароли не совпадают');
  expect(app.documents).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

test('complaint edits and deletions refresh the list in the same document', async ({ page }) => {
  const app = await workspace(page, { authenticated: true });
  await page.goto('/me/complaints');
  await page.getByRole('button', { name: 'Изменить жалобу', exact: true }).click();
  await page.getByLabel('Причина', { exact: true }).fill('Updated complaint');
  await page.getByRole('button', { name: 'Сохранить жалобу', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated complaint', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить жалобу', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить удаление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated complaint', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Жалоб в этом разделе пока нет/)).toBeVisible();
  expect(app.documents).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

-- Reference data only: no accounts, passwords, uploads or fabricated orders.
INSERT INTO workify.categories (slug, name) VALUES
    ('web-development', 'Веб-разработка'),
    ('mobile-development', 'Мобильная разработка'),
    ('desktop-development', 'Настольные приложения'),
    ('design', 'Дизайн интерфейсов'),
    ('data-and-databases', 'Данные и базы данных'),
    ('devops', 'DevOps и инфраструктура'),
    ('testing', 'Тестирование'),
    ('automation', 'Автоматизация')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO workify.skills (slug, name) VALUES
    ('javascript', 'JavaScript'), ('typescript', 'TypeScript'),
    ('react', 'React'), ('html', 'HTML'), ('css', 'CSS'),
    ('nodejs', 'Node.js'), ('express', 'Express'),
    ('postgresql', 'PostgreSQL'), ('sql', 'SQL'),
    ('python', 'Python'), ('java', 'Java'), ('csharp', 'C#'),
    ('kotlin', 'Kotlin'), ('swift', 'Swift'),
    ('docker', 'Docker'), ('linux', 'Linux'),
    ('git', 'Git'), ('figma', 'Figma'),
    ('automated-testing', 'Автоматизированное тестирование'), ('api-design', 'Проектирование API')
ON CONFLICT (slug) DO NOTHING;

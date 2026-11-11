export function createHealthRepository(database) {
  return {
    // метод проверки доступности базы через чтение модели аккаунтов
    async ping() {
      await database.users.findFirst({ select: { id: true } });

      return true;
    },
  };
}

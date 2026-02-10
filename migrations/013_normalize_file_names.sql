-- Нормализация имён файлов: "+" в имени заменяем на пробел (UTF-8).
-- Исправляет старые сообщения, сохранённые до нормализации в hub.
UPDATE messages
SET file_name = REPLACE(TRIM(file_name), '+', ' ')
WHERE file_name LIKE '%+%' AND file_name IS NOT NULL AND file_name != '';

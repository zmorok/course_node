import argon2 from 'argon2';

export const passwordOptions = Object.freeze({ type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const hashPassword = password => argon2.hash(password, passwordOptions);
export const verifyPassword = (hash, password) => argon2.verify(hash, password);

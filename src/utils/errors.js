export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 422: data terbaca tetapi tidak memenuhi aturan. details = { field: pesan } */
export class ValidationError extends AppError {
  constructor(details, message = 'Data yang dikirim tidak valid') {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

/** 404: resource tidak ada */
export class NotFoundError extends AppError {
  constructor(what = 'Data') {
    super(404, 'NOT_FOUND', `${what} tidak ditemukan`);
  }
}

/** 400: permintaan salah format (mis. ID bukan angka, JSON rusak) */
export class BadRequestError extends AppError {
  constructor(message, code = 'BAD_REQUEST') {
    super(400, code, message);
  }
}

/** 401: belum masuk / kredensial salah */
export class UnauthorizedError extends AppError {
  constructor(message = 'Silakan masuk terlebih dahulu') {
    super(401, 'UNAUTHORIZED', message);
  }
}

/** 409: konflik data (mis. email sudah terdaftar) */
export class ConflictError extends AppError {
  constructor(details, message = 'Data sudah ada') {
    super(409, 'CONFLICT', message, details);
  }
}

/** 429: terlalu banyak percobaan */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.') {
    super(429, 'TOO_MANY_REQUESTS', message);
  }
}

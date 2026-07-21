export class AttendanceLocationError extends Error {
  constructor(public readonly reason: 'unsupported' | 'permission' | 'unavailable' | 'timeout') {
    super(reason);
    this.name = 'AttendanceLocationError';
  }
}

export interface AttendanceLocation {
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
}

export function currentAttendanceLocation(): Promise<AttendanceLocation> {
  if (!navigator.geolocation) return Promise.reject(new AttendanceLocationError('unsupported'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        gpsAccuracyMeters: position.coords.accuracy,
      }),
      (error) => {
        const reason = error.code === error.PERMISSION_DENIED
          ? 'permission'
          : error.code === error.TIMEOUT
            ? 'timeout'
            : 'unavailable';
        reject(new AttendanceLocationError(reason));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
}

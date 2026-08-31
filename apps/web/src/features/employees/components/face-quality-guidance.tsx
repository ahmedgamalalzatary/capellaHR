import {
  employeeFaceQualityTone,
  type EmployeeFaceQuality,
  type EmployeeFaceQualityTone,
} from '../lib/employee-face-quality';

export const faceQualityMessages: Record<EmployeeFaceQuality['code'], string> = {
  ready: 'الصورة جاهزة للتسجيل',
  no_face: 'ضع وجهًا واحدًا داخل الإطار',
  multiple_faces: 'يجب أن يظهر وجه واحد فقط',
  too_far: 'اقترب قليلًا من الكاميرا',
  too_close: 'ابتعد قليلًا عن الكاميرا',
  off_center: 'ضع وجهك في منتصف الإطار',
  not_frontal: 'انظر مباشرة إلى الكاميرا',
  too_dark: 'الإضاءة ضعيفة؛ انتقل إلى مكان أكثر إضاءة',
  too_bright: 'الإضاءة قوية جدًا؛ ابتعد عن مصدر الضوء',
  blurry: 'الصورة غير واضحة؛ اثبت أمام الكاميرا',
};

const toneClasses: Record<EmployeeFaceQualityTone, { bar: string; text: string }> = {
  danger: { bar: 'bg-danger', text: 'text-danger' },
  warning: { bar: 'bg-warning', text: 'text-warning' },
  success: { bar: 'bg-success', text: 'text-success' },
};

export function FaceQualityGuidance({ quality }: { quality: EmployeeFaceQuality }) {
  const classes = toneClasses[employeeFaceQualityTone(quality)];
  return (
    <div className="mt-3">
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div
          role="progressbar"
          aria-label="جودة صورة الوجه"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={quality.score}
          className={`h-full transition-[width] ${classes.bar}`}
          style={{ width: `${Math.max(8, quality.score)}%` }}
        />
      </div>
      <p className={`mt-2 text-sm ${classes.text}`}>{faceQualityMessages[quality.code]}</p>
    </div>
  );
}

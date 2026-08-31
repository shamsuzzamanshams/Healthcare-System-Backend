import { z } from "zod";

export const applyDoctorValidationZodSchema = z.object({
	user: z.object({
		name: z
			.string()
			.min(2, "Name must be at least 2 characters long")
			.max(50, "Name cannot exceed 50 characters"),
		email: z.email("Invalid email format"),
	}),
	doctor: z.object({
		specialization: z.string().min(2, "Specialization is required"),
		licenseNumber: z.string().min(3, "Invalid license number"),
		qualifications: z.string().min(2, "Qualifications are required"),
		experienceYears: z
			.number()
			.int("Years of experience must be an integer")
			.min(0, "Experience cannot be negative")
			.optional(),
		bio: z
			.string()
			.max(1000, "Bio cannot exceed 1000 characters")
			.optional()
			.nullable(),
		consultationFee: z.number().min(0, "fee can not negative").optional(),
		contactNumber: z
			.string()
			.trim()
			.min(5, "contact number is invalid")
			.optional(),
		address: z
			.string()
			.max(255, "Address cannot exceed 255 characters")
			.optional()
			.nullable(),
	}),
});

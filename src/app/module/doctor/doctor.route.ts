import { Router } from "express";
import { validateRequest } from "../../middleware/validateRequest";
import { doctorController } from "./doctor.controller";
import { upload } from "../../lib/multer";


const router = Router();
router.post(
	"/apply-as-doctor",
	// validateRequest(UserValidation.ResetPasswordZodSchema),
    upload.fields([
        {
            name: "resume",
            maxCount: 1
        },
        {
            name: "additionalFiles",
            maxCount: 10
        }
    ]),
	doctorController.applyAsDoctor
);
export const DoctorRoutes = router;

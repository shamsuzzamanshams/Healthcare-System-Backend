import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { doctorServices } from "./doctor.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status"
import { applyDoctorValidationZodSchema } from "./doctor.validations";

const applyAsDoctor = catchAsync(async (req: Request, res: Response) => {

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const resume = files?.["resume"] ? files["resume"][0] : null;
	const additionalFiles = files?.["additionalFiles"] || [];

    const zodValidationResult = applyDoctorValidationZodSchema.safeParse(JSON.parse(req.body.data));

    if(!zodValidationResult.success){
        throw new Error(zodValidationResult.error.issues[0].message)
    }

    const payload = zodValidationResult.data

    // console.log({resume,additionalFiles,data});
    
	

	

	const result = await doctorServices.applyDoctor(payload, resume, additionalFiles)
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Applied as doctor successfully",
		data: result,
	});
});

export const doctorController = {
    applyAsDoctor
}
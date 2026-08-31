import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { doctorServices } from "./doctor.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status"

const applyAsDoctor = catchAsync(async (req: Request, res: Response) => {

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const resume = files?.["resume"] ? files["resume"][0] : null;
	const additionalFiles = files?.["additionalFiles"] || [];

    const data = JSON.parse(req.body.data);

    console.log({resume,additionalFiles,data});
    
	

	

	// const result = await doctorServices.applyDoctor()
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Applied as doctor successfully",
		data: {},
	});
});

export const doctorController = {
    applyAsDoctor
}
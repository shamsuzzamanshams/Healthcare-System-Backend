import { success } from "zod";
import config from "../../config";
import { getBkashToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import {
	AppointmentStatus,
	PaymentStatus,
	ScheduleStatus,
} from "../../../generated/prisma/enums";
import AppError from "../../utils/AppError";
import httpStatus from "http-status";
import { RequstUser } from "../../middleware/checkAuth";
import { IBookAppointmentPayload } from "./appointment.interface";
import { addMinutes, isBefore, isSameDay } from "date-fns";
import { transpoter } from "../../lib/nodemailer";

const bookAppointment = async (payload: IBookAppointmentPayload, user: RequstUser) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		// busness logic

		const patient = await prisma.patient.findUnique({
			where: { userId: user.userId },
		});

		if (!patient) {
			throw new AppError(httpStatus.NOT_FOUND, "Patient Profile Not Found");
		}

		const schedule = await prisma.schedule.findUnique({
			where: { id: payload.scheduleId },
			include: { doctor: true },
		});

		if (!schedule || schedule.isDeleted) {
			throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
		}

		if (schedule.status !== ScheduleStatus.PUBLISHED) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"This Schedule Is Not Published Yet",
			);
		}

		const now = new Date()

		if(!isSameDay(now, schedule.startDateTime)){
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"This Schedule Is Not Available Today",
			);
		}

		if(!isBefore(now, schedule.startDateTime)){
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"This Schedule Has Already Started",
			);
		}

		const existingAppointment = await prisma.appointment.findFirst({
			where : {
				patientId : patient.id,
				scheduleId : schedule.id,
				// status : { not : AppointmentStatus.CANCELLED }
			}
		})

		if(existingAppointment?.status === AppointmentStatus.PENDING){
			throw new AppError(httpStatus.BAD_REQUEST, "You Already Have A Pending Appointment. Please Pay For That")
		}

		if(existingAppointment?.status === AppointmentStatus.CONFIRMED){
			throw new AppError(httpStatus.BAD_REQUEST, "You Already Have A Confirmed Appointment.")
		}

		if(existingAppointment?.status === AppointmentStatus.ONGOING){
			throw new AppError(httpStatus.BAD_REQUEST, "You Already Have A Ongoing Appointment")
		}

		if(existingAppointment?.status === AppointmentStatus.COMPLETED){
			throw new AppError(httpStatus.BAD_REQUEST, "You Already Have Completed An Appointment On This Schedule. Please Try Again Another Day")
		}

		if(schedule.availableSlots === 0){
			throw new AppError(httpStatus.BAD_REQUEST, "This Schedule Is Fully Booked");
		}

		if(!schedule.doctor.consultationFee){
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Doctor Has Not Set A Consultation Fee Yet",
			);
		}

		const amount = schedule.doctor.consultationFee.toString();

		const appointment = await tx.appointment.create({
			data: {
				status: AppointmentStatus.PENDING,
				patientId : patient.id,
				doctorId : schedule.doctor.id,
				scheduleId : schedule.id
			},
		});
		const bkashIdToken = await getBkashToken();

		if (!bkashIdToken) {
			throw new AppError(httpStatus.BAD_GATEWAY, "No bkash access token found!");
		}
		const bkashCreatePaymentResponse = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/create`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: bkashIdToken,
					"X-App-Key": config.bkash_app_key,
				},

				body: JSON.stringify({
					mode: "0011",
					payerReference: user.email,
					callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
					// merchantAssociationInfo: "MI05MID54RF09123456One",
					amount: amount,
					currency: "BDT",
					intent: "sale",
					merchantInvoiceNumber: appointment.id,
				}),
			},
		);

		const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

		// payment model create

		await tx.payment.create({
			data: {
				merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
				appointmentId: appointment.id,
				amount: amount,
				getwayResponse: bkashCreatePaymentResult,
				bkashPaymentId: bkashCreatePaymentResult.paymentID,
				payerReference: user.email,
			},
		});

		return {
			paymentUrl: bkashCreatePaymentResult.bkashURL,
		};
	});

	return transactionResult;
};



const payAppointment = async (payload: any, user: RequstUser) => {
	const appointmentId = payload.appointmentId;

	const existingAppointment = await prisma.appointment.findUnique({
		where: {
			id: appointmentId,
		},
		include:{
			schedule:{
				include:{
					doctor: true
				}
			}
		}
	});

	if (!existingAppointment) {
		throw new AppError(httpStatus.NOT_FOUND, "Appointment Does Not Exists");
	}

	if (existingAppointment.status !== "PENDING") {
		throw new AppError(httpStatus.CONFLICT, "Appointment Is Not Pending!");
	}

	// if (existingAppointment.status === "CANCELLED" || existingAppointment.status === "ONGOING" || existingAppointment.status === "COMPLETED"){
	//     const appointmentStatus = existingAppointment.status
	//     throw new AppError(httpStatus.CONFLICT, `Appointment is already ${appointmentStatus.toLowerCase}`)
	// }

	if (!existingAppointment.schedule.doctor.consultationFee){
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Doctor Has Not Set A Consultation Fee Yet",
		);
	}


	const amount = existingAppointment.schedule.doctor.consultationFee.toString();
	const bkashIdToken = await getBkashToken();

	if (!bkashIdToken) {
		throw new AppError(httpStatus.BAD_GATEWAY, "No Bkash Access Token Found!");
	}

	const bkashCreatePaymentResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/create`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: bkashIdToken,
				"X-App-Key": config.bkash_app_key,
			},
			body: JSON.stringify({
				mode: "0011",
				// payerReference: "0123456789", //user email or phone number
				payerReference: user.email, //user email or phone number
				callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
				amount: amount,
				currency: "BDT",
				intent: "sale",
				// merchantInvoiceNumber: "Inv4" // apppointment id
				merchantInvoiceNumber: existingAppointment.id, // apppointment id
			}),
		},
	);

	const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

	await prisma.payment.update({
		where: {
			appointmentId: existingAppointment.id,
		},

		data: {
			merchantInvoiceNumber: appointmentId,
			getwayResponse: bkashCreatePaymentResult,
			bkashPaymentId: bkashCreatePaymentResult.paymentID,
		},
	});

	return {
		paymentUrl: bkashCreatePaymentResult.bkashURL,
	};
};

const bookAppointmentCallback = async (query: Record<string, any>) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const paymentId = query.paymentID;
		if (!paymentId) {
			throw new AppError(httpStatus.BAD_REQUEST, "Payment is missing");
		}
		const status = query.status;
		if (!status) {
			throw new AppError(httpStatus.BAD_REQUEST, "Payment Status is missing");
		}

		const bkashIdToken = await getBkashToken();

		if (!bkashIdToken) {
			throw new AppError(httpStatus.BAD_GATEWAY, "No bkash access token found!");
		}

		const executedPaymentResponse = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/execute`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: bkashIdToken,
					"X-App-Key": config.bkash_app_key,
				},

				body: JSON.stringify({
					paymentID: paymentId,
				}),
			},
		);

		const executedPaymentResult = await executedPaymentResponse.json();

		if (status === "success") {

			const appointment = await prisma.appointment.findUnique({
				where : {
					id: executedPaymentResult.merchantInvoiceNumber
				},
				include : {
					schedule : true,
					patient : true,
					doctor : true
				}
			});

			if(!appointment){
				throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found!")
			}

			const alreadyBookedSlots = appointment.schedule.totalSlots - appointment.schedule.availableSlots;

			const serialNumber = alreadyBookedSlots + 1

			const joiningTime = addMinutes(
				appointment.schedule.startDateTime, 
				(serialNumber - 1) * 20
			)

			await tx.appointment.update({
				where: {
					id: executedPaymentResult.merchantInvoiceNumber,
				},
				data: {
					status: AppointmentStatus.CONFIRMED,
					joiningTime,
					serialNumber
				},
			});

			const newAvailableSlots = appointment.schedule.availableSlots - 1;

			await prisma.schedule.update({
				where : {
					id : appointment.schedule.id
				},
				data : {
					availableSlots : newAvailableSlots
				}
			})

			await tx.payment.update({
				where: {
					appointmentId: executedPaymentResult.merchantInvoiceNumber,
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.PAID,
					bkashTrxId: executedPaymentResult.trxID,
					paidAt: executedPaymentResult.paymentExecuteTime,
					getwayResponse: executedPaymentResult,
				},
			});

			await transpoter.sendMail({
				from: config.email_sender,
				to: appointment.patient.email,
				subject: "Your Appointment Invoice - PH Healthcare System",
				text: "Thank you for booking an appointment. Please find your invoice attached.",
				// attachments : [
				// 	{
				// 		filename: "invoice.pdf",
				// 		content : pdfBuffer
				// 	}
				// ]
			})
			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=success`,
			};
		} else if (status === "failure") {
			await tx.payment.update({
				where: {
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.FAILED,
					getwayResponse: executedPaymentResult,
				},
			});
			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=failure`,
			};
		} else if (status === "cancel") {
			await tx.payment.update({
				where: {
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.CANCELLED,
					getwayResponse: executedPaymentResult,
				},
			});
			return {
				executedPaymentResult,
				redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=cancel`,
			};
		} else {
			return {
				executedPaymentResult,
				redirectUrl: `${config.frontend_url}/dashboard/my-appointment?error=payment-failed`,
			};
		}
	});
	return transactionResult;
};

const cancelAppointment = async (payload: any) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const appointmentId = payload.appointmentId;

		const existingAppointment = await tx.appointment.findUnique({
			where: {
				id: appointmentId,
			},
			include: {
				payment: true,
			},
		});

		if (!existingAppointment) {
			throw new AppError(httpStatus.NOT_FOUND, "Appointment Does Not Exists");
		}

		if (
			existingAppointment.status === "ONGOING" ||
			existingAppointment.status === "COMPLETED"
		) {
			throw new AppError(httpStatus.CONFLICT, "Appointment Ongoing or Completed");
		}

		if (existingAppointment.status === "CANCELLED") {
			throw new AppError(httpStatus.CONFLICT, "Appointment Already Cancelled");
		}

		const updatedAppointment = await tx.appointment.update({
			where: {
				id: existingAppointment.id,
			},
			data: {
				status: "CANCELLED",
			},
		});

		const bkashIdToken = await getBkashToken();

		if (!bkashIdToken) {
			throw new AppError(httpStatus.BAD_GATEWAY, "No Bkash Access Token Found!");
		}

		const bkashRefundPaymentResponse = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/payment/refund`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: bkashIdToken,
					"X-App-Key": config.bkash_app_key,
				},
				body: JSON.stringify({
					paymentID: existingAppointment.payment?.bkashPaymentId,
					trxID: existingAppointment.payment?.bkashTrxId,
					amount: existingAppointment.payment?.amount.toString(),
					sku: "Appointment Cancellation",
					reason: "Patient cancel appointment",
					
				}),
			});

		const bkashRefundPaymentResult = await bkashRefundPaymentResponse.json();

		console.log({bkashRefundPaymentResult});
		

		const updatePayment = await tx.payment.update({
			where:{
				appointmentId: existingAppointment.id
			},
			data:{
				refundTrxId: bkashRefundPaymentResult.refundTrxID,
				refundAt: bkashRefundPaymentResult.completedTime,
				refundAmount: bkashRefundPaymentResult.amount,
				refundReason: "Patient cancel appointment",
				status: PaymentStatus.REFUNDED,
				getwayResponse: bkashRefundPaymentResult,
			}
		})
		return{
			appointment: updatedAppointment,
			payment: updatePayment
		}
	});

	return transactionResult
};

export const AppointmentService = {
	bookAppointment,
	payAppointment,
	bookAppointmentCallback,
	cancelAppointment
};

import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import {
	AuthProvider,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import AppError from "../../utils/AppError";
import { jwtUtils } from "../../utils/jwt";
import path from "path";
import type {
	IForgotPasswordPayload,
	IGoogleLoginPayload,
	ILoginUserPayload,
	IRegisterPatientPayload,
	IRequestUser,
	IResetPasswordPayload,
	IVerifyEmailPayload,
} from "./auth.interface";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { googleClient } from "../../lib/googleAuth";
import crypto from "crypto";
import { redisClient } from "../../lib/redis";
import { transpoter } from "../../lib/nodemailer";
import ejs from "ejs";

const registerPatient = async (payload: IRegisterPatientPayload) => {
	const { name, password, patient: patientData } = payload;
	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new AppError(httpStatus.CONFLICT, "User with this email already exists");
	}

	const hashedPassword = await bcrypt.hash(password, 8);


	const expirationSeconds = 5 * 60
	const otpKey = `patient-registration-otp:${email}`
	const otpValue = crypto.randomInt(100000, 1000000).toString();
	await redisClient.set(otpKey, otpValue, {
		expiration: {
			type: "EX",
			value: expirationSeconds
		}
	})

	const patientRegistrationKey = `patient-registration-data:${email}`
	const redisUserDataPayload = {
		name,
		email,
		password: hashedPassword,
		patient: patientData
	}

	await redisClient.set(patientRegistrationKey, JSON.stringify(redisUserDataPayload), {
		expiration: {
			type: "EX",
			value: expirationSeconds
		}
	})


	const templatePath = path.join(process.cwd(), "src/app/templates/registration-user-otp.ejs")

	const templateData = {
		name,
		email,
		otp: otpValue,
		expirationMinutes: expirationSeconds / 60
	}

	const html = await ejs.renderFile(templatePath, templateData)



	await transpoter.sendMail({
		from: config.email_sender,
		to: email,
		subject: "Email Verification",
		// text: `Your OTP is ${otp}`
		html
	})



};

const verifyPatientEmail = async (payload: IVerifyEmailPayload) => {
	const otp = payload.otp;
	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});



	if (isUserExists?.status === "BLOCKED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is Blocked")
	}

	if (isUserExists?.emailVerified) {
		throw new AppError(httpStatus.CONFLICT, "Email Already Verified")
	}

	if (isUserExists?.isDeleted || isUserExists?.status === "DELETED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is Deleted")
	}

	const otpKey = `patient-registration-otp:${email}`

	const redisOtp = await redisClient.get(otpKey)

	if (!redisOtp) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP")
	}

	if (redisOtp !== otp) {
		throw new AppError(httpStatus.BAD_REQUEST, "OTP Does Not Match")
	}

	await redisClient.del(otpKey)

	const patientRegistrationKey = `patient-registration-data:${email}`

	const redisPatientData = await redisClient.get(patientRegistrationKey)

	if (!redisPatientData) {
		throw new AppError(httpStatus.NOT_FOUND, "Patient Does Not Exist")
	}

	const patientPayload: IRegisterPatientPayload = JSON.parse(redisPatientData)

	const createdUser = await prisma.user.create({
		data: {
			name: patientPayload.name,
			email: patientPayload.email,
			// ...payload,
			password: patientPayload.password,
			role: Role.PATIENT,
			status: UserStatus.ACTIVE,
			emailVerified: true,
			patient: {
				create: {
					name: patientPayload.name,
					email: patientPayload.email,
					contactNumber: patientPayload?.patient?.contactNumber || ""
				},
			},
		},
		omit: { password: true },
		include: { patient: true },
	});

	await redisClient.del(patientRegistrationKey)

	const templatePath = path.join(process.cwd(), "src/app/templates/patient-welcome-email.ejs")

	const templateData = {
		name: createdUser.name
	}

	const html = await ejs.renderFile(templatePath, templateData)



	await transpoter.sendMail({
		from: config.email_sender,
		to: email,
		subject: "Welcome To Healthcare System",
		// text: `Your OTP is ${otp}`
		html
	})

	const { patient, ...user } = createdUser;
	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		user,
		patient,
		accessToken,
		refreshToken,
	};


}

const loginUser = async (payload: ILoginUserPayload) => {
	const { password } = payload;
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is deleted");
	}

	if (user.password === null && user.googleId !== null) {
		throw new AppError(
			httpStatus.CONFLICT,
			"User Already Has Account Registered With Google. Try To Login With Google",
		);
	}

	const isPasswordMatched = await bcrypt.compare(
		password,
		user.password as string,
	);

	if (!isPasswordMatched) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Invalid credentials");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		include: {
			patient: true,
		},
		omit: {
			password: true,
		},
	});

	if (!isUserExists) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	return isUserExists;
};

const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid refresh token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: { id: data.userId },
	});

	if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User is inactive or not found");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const googleLogin = async (payload: IGoogleLoginPayload) => {
	let googleIdTokenPayload: TokenPayload | null | undefined = null;

	try {
		const ticket = await googleClient.verifyIdToken({
			idToken: payload.idToken,
			audience: config.google_clint_id,
		});

		googleIdTokenPayload = ticket.getPayload();
	} catch (error) {
		console.log("google id token verification faield", error);
		throw new AppError(httpStatus.UNAUTHORIZED, "invalid or expired google id token");
	}

	if (!googleIdTokenPayload) {
		throw new AppError(httpStatus.UNAUTHORIZED, "invalid or expired google id token");
	}

	if (!googleIdTokenPayload.email) {
		throw new AppError(httpStatus.BAD_REQUEST, "Google Email not found");
	}
	if (!googleIdTokenPayload.name) {
		throw new AppError(httpStatus.BAD_REQUEST, "Google User Name not found");
	}

	const ifPatientExistWithGoogleAuth = await prisma.user.findUnique({
		where: {
			email: googleIdTokenPayload.email,
			role: Role.PATIENT,
			googleId: googleIdTokenPayload.sub,
		},
	});

	let user = ifPatientExistWithGoogleAuth;

	if (!ifPatientExistWithGoogleAuth) {
		const ifPatientExistCredential = await prisma.user.findUnique({
			where: {
				email: googleIdTokenPayload.email,
				role: Role.PATIENT,
				authProvider: AuthProvider.CREDENTIAL,
			},
		});

		if (ifPatientExistCredential) {
			if (!ifPatientExistCredential.emailVerified) {
				throw new AppError(httpStatus.FORBIDDEN, "Email Not Verified");
			}
			if (ifPatientExistCredential.status === UserStatus.BLOCKED) {
				throw new AppError(httpStatus.FORBIDDEN, "User Is Blocked");
			}
			if (
				ifPatientExistCredential.isDeleted ||
				ifPatientExistCredential.status === UserStatus.DELETED
			) {
				throw new AppError(httpStatus.FORBIDDEN, "User Is Deleted");
			}

			user = await prisma.user.update({
				where: {
					id: ifPatientExistCredential.id,
				},
				data: {
					googleId: googleIdTokenPayload.sub,
				},
			});
		} else {
			user = await prisma.user.create({
				data: {
					name: googleIdTokenPayload.name,
					email: googleIdTokenPayload.email,
					role: Role.PATIENT,
					googleId: googleIdTokenPayload.sub,
					authProvider: AuthProvider.GOOGLE,
					emailVerified: true,
					patient: {
						create: {
							name: googleIdTokenPayload.name,
							email: googleIdTokenPayload.email,
						},
					},
				},
			});

			const templatePath = path.join(process.cwd(), "src/app/templates/patient-welcome-email.ejs")

			const templateData = {
				name: user.name
			}

			const html = await ejs.renderFile(templatePath, templateData)



			await transpoter.sendMail({
				from: config.email_sender,
				to: user.email,
				subject: "Welcome To Healthcare System",
				// text: `Your OTP is ${otp}`
				html
			})
		}
	}

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new AppError(httpStatus.FORBIDDEN, "User Is Blocked");
	}
	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new AppError(httpStatus.FORBIDDEN, "User Is Deleted");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
	const { email } = payload;

	const isUserExist = await prisma.user.findUnique({
		where: {
			email
		}
	});

	if (!isUserExist) {
		throw new AppError(httpStatus.NOT_FOUND, "User Does Not Exist!")
	};

	if (isUserExist.status === "BLOCKED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is Blocked")
	}

	if (!isUserExist.emailVerified) {
		throw new AppError(httpStatus.FORBIDDEN, "User Not Verified")
	}

	if (isUserExist.isDeleted || isUserExist.status === "DELETED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is Deleted")
	}

	if (isUserExist.googleId && isUserExist.authProvider === "GOOGLE") {
		throw new AppError(httpStatus.CONFLICT, "User Has Account With Google")
	}

	const otp = crypto.randomInt(100000, 1000000).toString();

	const key = `forgor-password-otp:${isUserExist.email}`

	const expirationSeconds = 5 * 60

	await redisClient.set(key, otp, {
		expiration: {
			type: "EX",
			value: expirationSeconds
		}
	})

	const templatePath = path.join(process.cwd(), "src/app/templates/forgot-password.ejs")

	const templateData = {
		name: isUserExist.name,
		otp,
		expirationMinutes: expirationSeconds / 60
	}

	const html = await ejs.renderFile(templatePath, templateData)



	await transpoter.sendMail({
		from: config.email_sender,
		to: isUserExist.email,
		subject: "Forgot Password",
		// text: `Your OTP is ${otp}`
		html
	})

};

const resetPassword = async (payload: IResetPasswordPayload) => {
	const { email, otp, newPassword } = payload;

	const isUserExist = await prisma.user.findUnique({
		where: {
			email
		}
	});

	if (!isUserExist) {
		throw new AppError(httpStatus.NOT_FOUND, "User Does Not Exist!")
	};

	if (isUserExist.status === "BLOCKED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is Blocked")
	}

	if (!isUserExist.emailVerified) {
		throw new AppError(httpStatus.FORBIDDEN, "User Not Verified")
	}

	if (isUserExist.isDeleted || isUserExist.status === "DELETED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is Deleted")
	}

	if (isUserExist.googleId && isUserExist.authProvider === "GOOGLE") {
		throw new AppError(httpStatus.CONFLICT, "User Has Account With Google")
	}

	const key = `forgor-password-otp:${isUserExist.email}`

	const redisOtp = await redisClient.get(key)

	if (!redisOtp) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP")
	}

	if (redisOtp !== otp) {
		throw new AppError(httpStatus.BAD_REQUEST, "OTP Does Not Match")
	}

	const hashedNewPassword = await bcrypt.hash(newPassword, Number(config.bcrypt_salt_rounds));

	await prisma.user.update({
		where: {
			email: isUserExist.email
		},
		data: {
			password: hashedNewPassword
		}
	});

	await redisClient.del([key]);

	const templatePath = path.join(process.cwd(), "src/app/templates/reset-password-success.ejs")

	const html = await ejs.renderFile(templatePath, {
		name: isUserExist.name,
	})

	await transpoter.sendMail({
		from: config.email_sender,
		to: isUserExist.email,
		subject: "Password Change",
		// text: `Your Password Is Changed Successfully`
		html
	})
};
export const AuthService = {
	registerPatient,
	verifyPatientEmail,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword,
	resetPassword
};

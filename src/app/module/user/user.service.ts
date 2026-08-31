import { error, log } from "node:console";
import { cloudinary } from "../../lib/cloudinary";
import { Result } from "pg";
import { prisma } from "../../lib/prisma";
import { UploadApiResponse } from "cloudinary";

const uploadProfileImage = async (buffer: Buffer, userId: string) => {
	// cloudinary.uploader.upload_stream(
	//     {
	//         resource_type: "auto"
	//     },
	//    async (error, result) =>{
	//         if(error){
	//             throw new Error(error.message)
	//         }
	//         console.log(result, "result");

	//         const updateUser = await prisma.user.update({
	//             where:{
	//                 id: userId
	//             },
	//             data:{
	//                 imageUrl: result?.secure_url,
	//                 imagePublicId: result?.public_id
	//             }
	//         })

	//         return result;
	//     }
	// ).end(buffer)

	const currentUser = await prisma.user.findUnique({
		where: {
			id: userId,
		},
		select: {
			imagePublicId: true,
			imageUrl: true,
		},
	});

	const cloudinaryResult = await new Promise<UploadApiResponse>(
		(resolve, reject) => {
			cloudinary.uploader
				.upload_stream(
					{
						resource_type: "auto",
					},
					async (error, result) => {
						if (error) {
							return reject(error);
						}

						if (!result) {
							return reject(new Error("No result return from cloudinary"));
						}

						resolve(result);
						console.log(result, "result");
					},
				)
				.end(buffer);
		},
	);

	const updateUser = await prisma.user.update({
		where: {
			id: userId,
		},
		data: {
			imageUrl: cloudinaryResult.secure_url,
			imagePublicId: cloudinaryResult.public_id,
		},
		omit: {
			password: true,
		},
	});

	if (currentUser?.imagePublicId && currentUser.imageUrl) {
		await cloudinary.uploader.destroy(currentUser.imagePublicId);
	}

	return updateUser;
};

export const UserService = {
	uploadProfileImage,
};
